const program = require( 'commander' );
const stdout = require( 'single-line-log' ).stdout;
const Table = require( 'cli-table' );
const colors = require( 'colors/safe' );

// Ours
const api         = require( '../lib/api' );
const utils       = require( '../lib/utils' );
const siteUtils   = require( '../lib/site' );
const hostUtils   = require( '../lib/host' );

program
	.command( 'upgrade' )
	.description( 'Update/Rebuild a site\'s web containers based on DC allocation records or default config' )
	.option( '-c, --client <client_id>', 'Client to target' )
	.option( '-l, --launched', 'Target launched sites only?' )
	.option( '-s, --search <search>', 'Search for sites to upgrade' )
	.option( '-n, --pagesize <pagesize>', 'Number of sites to update per batch', 5, parseInt )
	.option( '-e, --environment <env>', 'Environment to target' )
	.option( '-w, --wp <version>', 'WordPress version to target' )
	.option( '-i, --site <client_site_id>', 'Client Site ID to target' )
	.action( ( options ) => {
		// TODO: Optionally pass in a site ID for single site upgrade
		let query = {};

		if ( options.pagesize ) {
			query.pagesize = options.pagesize;
		}

		if ( options.environment ) {
			query.environment_name = options.environment;
		}

		if ( options.wp ) {
			query.wp = options.wp;
		}

		if ( options.client ) {
			query.client_id = options.client;
		}

		if ( options.launched ) {
			query.launched = 1;
		}

		if ( options.search ) {
			query.search = options.search;
		}

		// Note: This needs to come last so we appropriately nerf the query object
		if ( options.site ) {
			query = { client_site_id: options.site };
		}

		utils.displayNotice( [
			'Triggering web server update/rebuild:',
			query,
		] );

		siteUtils.update( null, query )
			.then( data => {
				let failed = data.failed.map( d => d.name || d.domain_name );

				if ( failed.length > 0 ) {
					console.log( 'Warning: Failed to queue upgrades for ', failed.join( ', ' ) );
				}

				// Continue with sites that were successfully queued
				return data.sites;
			})
			.then( sites => {
				if ( sites.length <= 0 ) {
					return console.log( "No sites to update" );
				}

				api
					.get( '/container_types/1' )
					.end( ( err, res ) => {
						if ( err ) {
							return console.error( 'Could not retrieve default software stack' );
						}

						var defaultStack = res.body.data[0].software_stack_name;

						var updatingInterval = setInterval( () => {
							let upgrading = sites.map( site => {
								return siteUtils.getContainers( site )
								.then( containers => containers.filter( container => container.container_type_id === 1 ) );
							});

							Promise.all( upgrading )
							.then( sites => {
								var table = new Table({
									head: [ 'Site', 'Container ID', 'Container Status', 'Software Stack' ],
									style: {
										head: ['blue'],
									},
								});

								sites.forEach( site => {
									site.forEach( container => {
										let colorizedState = container.state;

										switch ( colorizedState ) {
										case 'running':
											if ( container.software_stack_name === defaultStack ) {
												colorizedState = colors['green']( colorizedState );
											} else {
												colorizedState = colors['yellow']( colorizedState );
											}
											break;
										case 'upgrading':
											colorizedState = colors['blue']( colorizedState );
											break;
										case 'stopped':
										case 'uninitialized':
											colorizedState = colors['red']( colorizedState );
										}

										table.push( [
											container.domain_name,
											container.container_id,
											colorizedState,
											container.software_stack_name,
										] );
									});
								});

								let done = sites.every( site => {
									return site.every( container => {
										if ( container.state !== 'running' && container.state !== 'stopped' && container.state !== 'uninitialized' ) {
											return false;
										}

										return container.software_stack_name === defaultStack;
									});
								});

								let output = table.toString();
								stdout( output );

								// TODO: Also check DC allocations because we might not be upgrading to the default
								if ( done ) {
									clearInterval( updatingInterval );
									console.log();
									console.log( 'Update complete' );
								}
							})
							.catch( err => console.error( err.message ) );
						}, 2000 );
					});
			})
			.catch( err => console.error( err.message ) );
	});

program
	.command( 'search <query>' )
	.description( 'Search sites' )
	.action( query => {
		api.get( '/sites' )
			.query({ 'search': query, pagesize: 10 })
			.end( ( err, res ) => {
				if ( err ) {
					return console.error( err.response.error );
				}

				var table = new Table({
					head: [
						'ID',
						'Name',
						'Domain',
					],
					style: {
						head: ['blue'],
					},
				});

				res.body.data.forEach( s => {
					table.push( [
						s.client_site_id,
						s.name || s.domain_name,
						s.primary_domain.domain_name,
					] );
				});

				console.log( table.toString() );
				console.log( res.body.result + ' of ' + res.body.totalrecs + ' results.' );
			});
	});

program
	.command( 'retire <site>' )
	.description( 'Retire a site by stopping and removing all containers.' )
	.action( site => {
		utils.findSite( site, ( err, site ) => {
			if ( err ) {
				return console.error( err );
			}

			if ( ! site ) {
				return console.error( 'Specified site does not exist. Try the ID.' );
			}

			const displayContainerStatus = ( site ) => {
				const Table = require( 'cli-table' );
				const stdout = require( 'single-line-log' ).stdout;

				siteUtils.getContainers( site )
					.then( containers => {
						const table = new Table({
							head: [ '#', 'Name', 'Type', 'Status' ],
							style: {
								head: [ 'blue' ],
							},
						});

						containers.forEach( container => {
							table.push( [
								container.container_id,
								container.container_name,
								container.container_type_name,
								container.state,
							] );
						});

						stdout( table.toString() + '\n\n' + `Last updated: ${ new Date().toISOString() }` );
					})
					.catch( err => console.error( 'Failed to get container status. Will retry shortly...', err ) );
			};

			const retireSite = () => {
				const tearDown = () => {
					clearInterval( updateInterval );
				};

				const updateInterval = setInterval( () => displayContainerStatus( site ), 3000 );

				siteUtils.retire( site, ( err, result ) => {
					if ( err ) {
						tearDown();
						return console.error( 'Failed to retire site due to an error', err );
					}

					tearDown();

					console.log( 'All done!' );
				});
			};

			utils.displayNotice( [
				'Request to retire site:',
				`-- Site: ${ site.domain_name } (#${ site.client_site_id })`,
				'-- Environment: ' + site.environment_name,
			] );

			if ( ! site.active ) {
				return console.error( 'This site has either not been initialized or has already been retired.' );
			}

			utils.maybeConfirm( `This will stop and delete all containers and then disable site ${ site.domain_name } (#${site.client_site_id }). Are you sure?`, true, ( err, yes ) => {
				if ( ! yes ) {
					return;
				}

				utils.maybeConfirm( 'Are you really, really sure (there is no turning back)?', true, ( err, yes ) => {
					if ( ! yes ) {
						return;
					}

					if ( site.environment_name !== 'production' ) {
						return retireSite();
					}

					// One last check for production sites
					utils.maybeConfirm( 'This is a PRODUCTION site. Are you absolutely sure?', true, ( err, yes ) => {
						if ( ! yes ) {
							return;
						}

						return retireSite();
					});
				});
			});
		});
	});

program.parse( process.argv );
if ( ! process.argv.slice( 2 ).length ) {
	program.help();
}
