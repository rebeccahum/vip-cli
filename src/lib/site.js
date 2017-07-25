// Others
const async = require( 'async' );
const querystring = require( 'querystring' );

// Ours
const api = require( './api' );
const containerUtils = require( './container' );

export function update( site, opts ) {
	opts = opts || {};
	site = site || {};

	let url = Object.keys( opts ).length > 0 ?
		`/actions/upgrade_wp` :
		`/actions/${site.client_site_id}/upgrade_wp`;

	return new Promise( ( resolve, reject ) => {
		api
			.post( url )
			.query( opts )
			.end( ( err, res ) => {
				if ( err ) {
					let message = err.response.error;
					if ( err.response.body ) {
						message += ' | ' + err.response.body.message;
					}

					return reject( new Error( message ) );
				}

				if ( ! res.body || 'success' !== res.body.status ) {
					return reject( new Error( 'Failed to create rebuild/upgrade actions for site' ) );
				}

				return resolve( res.body );
			});
	});
}

export function getContainers( site, query ) {
	return new Promise( ( resolve, reject ) => {
		let url = '/sites/' + site.client_site_id + '/containers';
		if ( query ) {
			url += '?' + querystring.stringify( query );
		}

		api
			.get( url )
			.end( ( err, res ) => {
				if ( err ) {
					return reject( err.response.error );
				}

				if ( ! res.body || 'success' !== res.body.status ) {
					return reject( new Error( 'Failed to fetch containers for site.' ) );
				}

				return resolve( res.body.data );
			});
	});
}

export function deleteSite( site, done ) {
	const url = `/sites/${ site.client_site_id }`;

	api.del( url )
		.end( ( err, response ) => {
			if ( err ) {
				return done( err );
			}

			done( null, response.body );
		});
}

export function retire( site, onEnd ) {
	const onDoneTaskHandler = ( done ) => {
		return ( err, results ) => {
			if ( err ) {
				return done( err );
			}
			done( null, results );
		};
	};

	const filterContainersBySiteTypeDC = ( containers ) => {
		// Only need one of each type of container
		const filteredContainersObject = containers.reduce( ( containers, container ) => {
			// We have a unique constraint for site id, type id, and dc.
			// We've already filtered by site id so need to get unique combinations of type and dc.
			const uniqId = `${ container.container_type_id }-${ container.datacenter }`;
			if ( ! containers[ uniqId ] ) {
				containers[ uniqId ] = container;
			}
			return containers;
		}, {});

		return Object.keys( filteredContainersObject ).map( key => filteredContainersObject[ key ] );
	};

	const disableAllocationChecks = ( site, done ) => {
		getContainers( site )
			.then( containers => {
				console.log( 'Adding DC Allocations...' );

				const filteredContainers = filterContainersBySiteTypeDC( containers );

				const setMinToZero = ( container, done ) => containerUtils.setDCAllocation( container, { active: 1, min_instances: 0, max_instances: 10 }, done );

				async.eachSeries( filteredContainers, setMinToZero, onDoneTaskHandler( done ) );
			})
			.catch( err => done( err ) );
	};

	const checkForContainerState = ( site, typeId, state, done ) => {
		getContainers( site ).
			then( containers => {
				if ( typeId !== null ) {
					containers = containers.filter( container => container.container_type_id === typeId );
				}
				const notAtState = containers.find( c => c.state !== state );

				if ( notAtState ) {
					return done( null, false );
				}

				return done( null, true );
			})
			.catch( err => done( err ) );
	};

	const waitForStoppedContainers = ( site, typeId, done ) => {
		const wait = () => {
			checkForContainerState( site, typeId, 'stopped', ( err, allAtState ) => {
				if ( err ) {
					return done( err );
				}

				if ( ! allAtState ) {
					return setTimeout( wait, 1000 );
				}

				done();
			});
		};

		wait();
	};

	const waitForDeletedContainers = ( site, done ) => {
		const wait = () => {
			checkForContainerState( site, null, 'deleted', ( err, allAtState ) => {
				if ( err ) {
					return done( err );
				}

				if ( ! allAtState ) {
					return setTimeout( wait, 1000 );
				}

				done();
			});
		};

		wait();
	};

	const deleteAllocationChecks = ( site, done ) => {
		getContainers( site, { active: 'any' })
			.then( containers => {
				console.log( 'Removing DC Allocations...' );

				const filteredContainers = filterContainersBySiteTypeDC( containers );

				const deleteAllocations = ( container, done ) => containerUtils.setDCAllocation( container, { active: 0 }, done );

				async.eachSeries( filteredContainers, deleteAllocations, onDoneTaskHandler( done ) );
			})
			.catch( err => done( err ) );
	};

	const stopContainersByType = ( site, typeId, done ) => {
		getContainers( site )
			.then( containers => {
				const filteredContainers = containers.filter( container => container.container_type_id === typeId );

				console.log( `Stopping containers of type ID ${ typeId }` );

				async.eachSeries( filteredContainers, containerUtils.stopContainer, onDoneTaskHandler( done ) );
			})
			.catch( err => done( err ) );
	};

	const deleteContainers = ( site, done ) => {
		getContainers( site )
			.then( containers => {
				console.log( 'Deleting containers...' );

				async.eachSeries( containers, containerUtils.deleteContainer, onDoneTaskHandler( done ) );
			})
			.catch( err => done( err ) );
	};

	return async.series( [
		( done ) => disableAllocationChecks( site, done ),
		// Need to stop containers in order
		( done ) => stopContainersByType( site, 1, done ), // web
		( done ) => waitForStoppedContainers( site, 1, done ),
		( done ) => stopContainersByType( site, 3, done ), // mem
		( done ) => waitForStoppedContainers( site, 3, done ),
		( done ) => stopContainersByType( site, 2, done ), // db
		( done ) => waitForStoppedContainers( site, 2, done ),
		( done ) => setTimeout( done, 10000 ),
		( done ) => deleteContainers( site, done ),
		( done ) => waitForDeletedContainers( site, done ),
		( done ) => setTimeout( done, 10000 ),
		( done ) => deleteAllocationChecks( site, done ),
		( done ) => deleteSite( site, done ),
	], onEnd );
}
