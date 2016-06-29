#!/usr/bin/env node

var fs = require( 'fs' );
var program = require( 'commander' );
var async = require( 'async' );
var mysql = require( 'mysql' );
var api = require( '../src/api' );
var utils = require( '../src/utils' );

function list(v) {
	return v.split(',');
}

program
	.command( 'files <site> <directory>' )
	.description( 'Import files to a VIP Go site' )
	.option( '-t, --types', 'Types of files to import', list, ['jpg', 'jpeg', 'png', 'gif'] )
	.option( '-p, --parallel', 'Number of parallel uploads', parseInt, 5 )
	.action( ( site, directory ) => {
		utils.findAndConfirmSite( site, site => {
			api
				.get( '/sites/' + site.client_site_id + '/meta/files_access_token' )
				.end( ( err, res ) => {
					if ( err ) {
						return console.error( err.response.error );
					}

					// TODO: List files recursively
					// TODO: Upload files in parallel
					// TODO: Progress bar
				});
		});
	});

program
	.command( 'sql <site> <file>' )
	.description( 'Import SQL to a VIP Go site' )
	.action( ( site, file ) => {
		var progress = require( 'progress' );

		utils.findAndConfirmSite( site, site => {

			// Get mysql info
			api
				.get( '/sites/' + site.client_site_id + '/masterdb' )
				.end( ( err, res ) => {
					if ( err ) {
						return console.error( err.response.error );
					}

					var db = res.body,
						sql = fs.readFileSync( file ).toString()
							.split( /;(\r\n|\r|\n)/ )
							.map( s => s.trim() )
							.filter( s => s.length > 0 );

					var connection = mysql.createConnection({
						host: db.host,
						port: db.port,
						user: db.username,
						password: db.password,
						database: db.name,
					});

					var bar = new progress( 'Importing [:bar] :percent :etas', { total: sql.length } );

					// Test DB connection
					connection.query( 'SELECT 1', err => {
						if ( err ) {
							return console.error( err );
						}

						async.eachSeries( sql, ( sql, cb ) => {

							// Import sql
							connection.query( sql, err => {
								if ( err ) {
									return cb( err );
								}

								// Report progress
								bar.tick();
								cb();
							});
						}, err => {
							connection.end();
							// TODO: Queue cache flush

							if ( err ) {
								console.error( err );
							}
						});
					});
				});
		});
	});

program.parse( process.argv );

if ( ! process.argv.slice( 2 ).length ) {
	program.outputHelp();
}
