#!/usr/bin/env node

const fs       = require( 'fs' );
const program  = require( 'commander' );
const which = require( 'which' );

// Ours
const db = require( '../lib/db' );
const utils = require( '../lib/utils' );

program
	.command( 'tables <site> <tables>' )
	.description( 'Export tables from a VIP Go site' )
	.action( ( site, tables, options ) => {
		try {
			which.sync( 'mysql' );
		} catch ( e ) {
			return console.error( 'MySQL client is required and not installed. ');
		}

		utils.findSite( site, ( err, s ) => {
			if ( err ) {
				return console.error( err );
			}

			if ( ! s ) {
				return console.error( "Couldn't find site:", site );
			}

			if ( ! require( 'tty' ).isatty( 1 ) ) {
				console.log( '-- Site:', s.client_site_id );
				console.log( '-- Domain:', s.domain_name );
				console.log( '-- Environment:', s.environment_name );
				return db.exportTables( s, tables, err => {
					if ( err ) {
						return console.error( err );
					}
				});
			}

			utils.displayNotice( [
				'Connecting to database:',
				`-- Site: ${ s.domain_name } (#${ s.client_site_id })`,
				'-- Environment: ' + s.environment_name,
			] );


			promptly.confirm( ays, ( err, t ) => {
				if ( err ) {
					return console.error( err );
				}

				if ( ! t ) {
					return;
				}

				return db.getCLI( s, err => {
					if ( err ) {
						return console.error( err );
					}
				});
			});
		});
	});

program.parse( process.argv );
if ( ! process.argv.slice( 2 ).length ) {
	program.help();
}
