// Ours
const api = require( '../lib/api' );

export function update( site ) {
	return new Promise( ( resolve, reject ) => {
		api
			.post( '/actions/' + site.client_site_id + '/upgrade_wp' )
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

export function getContainers( site ) {
	return new Promise( ( resolve, reject ) => {
		api
			.get( '/sites/' + site.client_site_id + '/containers' )
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
