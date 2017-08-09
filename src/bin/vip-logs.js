#!/usr/bin/env node

const program = require( 'commander' );
const elasticsearch = require( 'elasticsearch' );

// Ours
const utils = require( '../lib/utils' );
const constants = require( '../constants' );

program
	.arguments( '<site>' )
	.option( '-n, --pagesize <pagesize>', 'Number of results to return', 10, parseInt )
	.option( '-p, --page <page>', 'Page', 1, parseInt )
	.action( ( site, options ) => {
		utils.findSite( site, ( err, site ) => {
			if ( err ) {
				return console.error( err );
			}

			if ( ! site ) {
				return console.error( "Couldn't find site" );
			}

			const es = new elasticsearch.Client({
				host: constants.LOGSTASH_HOST,
			});

			es.ping({
				requestTimeout: 1000,
			}, err => {
				if ( err ) {
					return console.error( err );
				}

				es.search({
					index: 'vipv2-php-errors-*',
					q: 'client_site_id:' + site.client_site_id,
					size: options.pagesize,
					from: ( options.page - 1 ) * options.pagesize,
				}, function more( err, result ) {
					if ( err ) {
						return console.error( err );
					}

					result = result.hits.hits.map( r => {
						return r._source;
					});

					console.log( result );
				});
			});
		});
	});

program.parse( process.argv );
if ( ! process.argv.slice( 2 ).length ) {
	program.help();
}
