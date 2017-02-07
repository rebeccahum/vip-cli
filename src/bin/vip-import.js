#!/usr/bin/env node

const fs       = require( 'fs' );
const urlUtils = require( 'url' );
const readline = require( 'line-by-line' );
const walk     = require( 'walk' );
const program  = require( 'commander' );
const async    = require( 'async' );
const progress = require( 'progress' );
const request  = require( 'superagent' );
const execFile = require('child_process').execFile;
const which    = require( 'which' );
const promptly = require( 'promptly' );

// Ours
const api      = require( '../lib/api' );
const utils    = require( '../lib/utils' );
const db = require( '../lib/db' );
const imports = require( '../lib/import' );

function list( v ) {
	return v.split( ',' );
}

const default_types = [
	'jpg','jpeg','jpe',
	'gif',
	'png',
	'bmp',
	'tiff','tif',
	'ico',
	'asf',
	'asx',
	'wmv','wmx','wm',
	'avi',
	'divx',
	'mov',
	'qt',
	'mpeg','mpg','mpe','mp4','m4v',
	'ogv',
	'webm',
	'mkv',
	'3gp','3gpp','3g2','3gp2',
	'txt',
	'asc',
	'c','cc','h',
	'srt',
	'csv','tsv',
	'ics',
	'rtx',
	'css',
	'vtt',
	'dfxp',
	'mp3',
	'm4a','m4b',
	'ra',
	'ram',
	'wav',
	'ogg',
	'oga',
	'mid','midi',
	'wma',
	'wax',
	'mka',
	'rtf',
	'js',
	'pdf',
	'class',
	'tar','zip','gz','gzip','rar','7z',
	'psd',
	'xcf',
	'doc',
	'pot',
	'pps',
	'ppt',
	'wri',
	'xla','xls','xlt','xlw',
	'mdb','mpp',
	'docx','docm','dotx','dotm',
	'xlsx','xlsm','xlsb','xltx','xltm','xlam',
	'pptx','pptm','ppsx','ppsm','potx','potm','ppam',
	'sldx','sldm',
	'onetoc','onetoc2','onetmp','onepkg','oxps',
	'xps',
	'odt','odp','ods','odg','odc','odb','odf',
	'wp','wpd',
	'key','numbers','pages',
];

const INTERMEDIATE_IMAGE_REGEX = /-\d+x\d+\.\w{3,4}$/;

program
	.command( 'files <site> <directory>' )
	.description( 'Import files to a VIP Go site' )
	.option( '-t, --types <types>', 'Types of files to import', default_types, list )
	.option( '-e, --extra-types <types>', 'Additional file types to allow that are not included in WordPress defaults', [], list )
	.option( '-p, --parallel <threads>', 'Number of parallel uploads. Default: 5', 5, parseInt )
	.option( '-i, --intermediate', 'Upload intermediate images' )
	.option( '-f, --fast', 'Skip existing file check' )
	.action( ( site, directory, options ) => {
		if ( 0 > directory.indexOf( 'uploads' ) ) {
			return console.error( 'Invalid uploads directory. Uploads must be in uploads/' );
		}

		utils.findAndConfirmSite( site, 'Importing files for site:', site => {
			api
				.get( '/sites/' + site.client_site_id + '/meta/files_access_token' )
				.end( ( err, res ) => {
					if ( err ) {
						return console.error( err.response.error );
					}

					if ( ! res.body || ! res.body.data || ! res.body.data[0] || ! res.body.data[0].meta_value ) {
						return console.error( 'Could not get files access token' );
					}

					var access_token = res.body.data[0].meta_value;
					var bar, filecount = 0;

					var processFiles = function( importing, callback ) {
						var queue = async.priorityQueue( ( file, cb ) => {
							// Handle pointers separately - add next 5k files + next pointer if necessary
							if ( 'ptr:' === file.substring( 0, 4 ) ) {
								var parts = file.split( ':' );
								var offset = parseInt( parts[1] );

								file = parts[2];

								// Queue next batch of files in this directory
								return imports.queueDir( file, offset, function( q ) {
									q.forEach( i => {
										queue.push( i.item, i.priority );
									});

									return cb();
								});
							}

							async.waterfall( [
								function( cb ) {
									fs.realpath( file, cb );
								},

								function( file, cb ) {
									fs.lstat( file, function( err, stats ) {
										cb( err, file, stats );
									});
								},
							], function( err, file, stats ) {
								if ( err ) {
									return cb( err );
								} else if ( stats.isDirectory() ) {
									// Init directory queueing with offset=0
									imports.queueDir( file, 0, function( q ) {
										q.forEach( i => {
											queue.push( i.item, i.priority );
										});

										return cb();
									});
								} else if ( stats.isFile() ) {
									var filepath = file.split( 'uploads' );

									if ( ! isAllowedType( file, options.types, options.extraTypes ) ) {
										return cb( new Error( "Unsupported filetype: " + file ) );
									}

									if ( ! options.intermediate && INTERMEDIATE_IMAGE_REGEX.test( file ) ) {
										return cb( new Error( 'Skipping intermediate image: ' + file ) );
									}

									if ( ! filepath[1] ) {
										return cb( new Error( 'Invalid file path. Files must be in uploads/ directory.' ) );
									}

									if ( ! importing ) {
										filecount++;

										if ( 0 === filecount % 10000 ) {
											console.log( filecount );
										}

										return cb();
									}

									if ( options.fast ) {
										bar.tick();
										return imports.upload( site, file, access_token, cb );
									} else {
										request
											.get( 'https://files.vipv2.net/wp-content/uploads' + filepath[1] )
											.set({ 'X-Client-Site-ID': site.client_site_id })
											.set({ 'X-Access-Token': access_token })
											.set({ 'X-Action': 'file_exists' })
											.timeout( 2000 )
											.end( err => {
												bar.tick();

												if ( err && err.status === 404 ) {
													return imports.upload( site, file, access_token, cb );
												}

												return cb( err );
											});
									}
								} else {
									return cb();
								}
							});
						}, 5 );

						if ( callback ) {
							queue.drain = callback;
						}

						// Start it
						queue.push( directory, 1 );
					};

					// TODO: Cache file count to disk, hash directory so we know if the contents change?
					console.log( 'Counting files...' );
					processFiles( false, function() {
						bar = new progress( 'Importing [:bar] :percent (:current/:total) :etas', { total: filecount, incomplete: ' ', renderThrottle: 100 });
						console.log( 'Importing ' + filecount + ' files...' );
						processFiles( true );
					});
				});
		});
	});

/**
 * Generate a listing of all files in a directory, to be used when scraping files
 */
program
	.command( 'list-files <directory> <http_base_url>' )
	.description( 'Generate a list of all importable files in a directory, to be scraped' )
	.option( '-t, --types <types>', 'Types of files to import', default_types, list )
	.option( '-e, --extra-types <types>', 'Additional file types to allow that are not included in WordPress defaults', [], list )
	.action( ( directory, httpBaseUrl, options ) => {
		var walker = walk.walk( directory );

		walker.on( 'file', ( root, file, next ) => {
			// Check file type
			if ( ! isAllowedType( file, options.types, options.extraTypes ) ) {
				return next();
			}

			if ( ! options.intermediate && INTERMEDIATE_REGEX.test( file ) ) {
				return next();
			}


			// @todo logging of skipped images?





			var relativePath = root.replace( directory, '' );

			var url = httpBaseUrl + relativePath + '/' + file.name;

			console.log( url );

			next();
		});
	});

/**
 * Scrape the list of urls in the file <list> and import them into <site>
 */
program
	.command( 'scrape-files <site> <list>' )
	.description( 'Generate a list of all importable files in a directory, to be scraped' )
	.option( '-b, --blog-id', 'Blog ID of destination site (for multisite installs only)' )
	.option( '-t, --types <types>', 'Types of files to import', default_types, list )
	.option( '-e, --extra-types <types>', 'Additional file types to allow that are not included in WordPress defaults', [], list )
	.option( '-p, --parallel <threads>', 'Number of parallel uploads. Default: 5', 5, parseInt )
	.option( '-i, --intermediate', 'Upload intermediate images' )
	.option( '-f, --fast', 'Skip existing file check' )
	.action( ( site, filesList, options ) => {
		var site         = null;
		var access_token = null;
		var filecount    = 0;
		var bar          = null;
		var reader       = null;
		var parallel     = parseInt( options.parallel );

		async.waterfall([



			/*utils.findAndConfirmSite.bind( utils, site, 'Importing files for site:' ),
			( site, done ) => {
				api
					.get( '/sites/' + site.client_site_id + '/meta/files_access_token' )
					.end( done );
			},
			( res, done ) => {
				site = res.body.data[0];

				return done( null );
			},
			( res, done ) => {
				if ( ! res.body || ! res.body.data || ! res.body.data[0] || ! res.body.data[0].meta_value ) {
					return console.error( 'Could not get files access token' );
				}

				access_token = res.body.data[0].meta_value;

				return done( null );
			},*/


			// Get the WP blog id of the target site (if multisite), so we can properly
			// construct multisite file urls
			/*( done ) => {
				// Not a multisite, nothing to do
				if ( ! site.is_multisite ) {
					return done( null );
				}

				request.get( 'https://' . site.primary_domain.domain_name . '/wp-json/vip/v1/sites' )
					.timeout( 10 )
					.end( ( err, response ) => {
						if ( err ) {
							return done( err)
						}

						// If a blog id was specified, make sure it's in the list



						// Find the chosen site out of the list

						// @todo this endpoint doesn't return an id i can use

						var id = null;


						// Save the id into the site object for later use
						options[ 'blog-id' ] = id;

						// site.target_blog_domain =

						return done( null );
					});
			},*/


			execFile.bind( null, 'wc', [ '-l', filesList ] ),
			( stdout, stderr, done ) => {
				// Must replace out the filename, as `wc -l` returns it unless
				// you pipe it STDIN, which we can't do with `execFile`. Also
				// trim (wc adds spaces for formatting)
				filecount = parseInt( stdout.replace( filesList, '' ).trim() );

				return done( null );
			},
			// Prompt user to confirm
			( done ) => {
				var confirm = 'Will import ' + filecount + ' files into ' + site.primary_domain.domain_name + ' (' + site.client_site_id + ')';

				if ( site.is_multisite ) {


					// @todo add on blogs domain for sanity check
					confirm += ' (Blog ID ' + options['blog-id'] + ')';
				}

				confirm += '. Continue? (y/n)';

				promptly.prompt( confirm, {
					default: 'n',
					validator: ( value ) => {
						if ( -1 === [ 'n', 'y' ].indexOf( value ) ) {
							throw new Error( 'Please type \'y\' or \'n\'' );
						}

						return value;
					},
					retry: true, // If validator fails, auto-retry
				}, ( err, value ) => {
					if ( err ) {
						return done( err );
					}

					if ( 'n' === value ) {
						console.log( 'You have chosen...wisely. Import aborted.' );

						return process.exit();
					}

					return done( null );
				});
			},



		], ( err ) => {
			if ( err ) {
				return console.error( err );
			}

			bar = new progress( 'Importing [:bar] :percent (:current/:total) :etas', {
				total: filecount,
				incomplete: ' ',
				renderThrottle: 100,
			});

			// Setup queue to handle concurrency
			var queue = async.queue( scrapeFile, parseInt( parallel ) );

			// When the queue's concurrency is less than the max, we can resume reading
			// the input file
			queue.unsaturated = () => {
				reader.resume();
			};

			// NOTE - Decided to use the line-by-line package instead of native 'readline'
			// because the pause/resume in readline wasn't working correctly
			reader = new readline( filesList );

			reader.on( 'line', ( url ) => {
				if ( ! isAllowedType( url, options.types, options.extraTypes ) ||
					( ! options.intermediate && INTERMEDIATE_REGEX.test( file ) ) ||
					! isImportableMediaUrl( url ) ) {
					bar.tick();

					console.log( 'Skipping ' + url );

					return;
				}

				queue.push({
					url:          url,
					site:         site,
					access_token: access_token,
					bar:          bar,
				});

				if ( queue.length() > parallel * 1.5 ) { // Allow queue to be 1.5x concurrency
					reader.pause();
				}
			});
		});
	});

function scrapeFile( data, callback ) {

	// @todo Handle 'fast' param

	// @todo handle the tick

	// @todo figure out how to handle the callback

	// @todo have a CLI argument for forcing the blog id...so if we couldn't determine it or it's a private site, we can still import

	var relativePath = getGoFilesRelativePath( data.url, data.site );

	// Url will be /wp-content/uploads/... with a sites/:id on multisite
	var url = 'https://files.vipv2.net/' + relativePath;


	var upload = request
		.put( url )
		.set({
			'X-Client-Site-ID': data.site.client_site_id,
			'X-Access-Token': data.access_token,
		});

	var output = fs.createWriteStream( relativePath );

	var download = request
		.get( data.url )
		.timeout({
			response: 10000, // Wait up to 10 seconds for the server to respond (doesn't limit total download time)
		})
		.on( 'error', streamingDownloadErrorHandler )
		//.pipe( upload );

		// Temp testing only
		.pipe( output );
}

program
	.command( 'sql <site> <file>' )
	.alias( 'database' )
	.description( 'Import SQL to a VIP Go site' )
	.option( '-t, --throttle <mb>', 'SQL import transfer limit in MB/s', 1, parseFloat )
	.action( ( site, file, options ) => {
		try {
			which.sync( 'mysql' );
		} catch ( e ) {
			return console.error( 'MySQL client is required and not installed.' );
		}

		var opts = {
			throttle: options.throttle,
		};

		utils.findAndConfirmSite( site, 'Importing SQL for site:', site => {
			db.importDB( site, file, opts, err => {
				if ( err ) {
					return console.error( err );
				}

				api
					.post( '/sites/' + site.client_site_id + '/wp-cli' )
					.send({
						command: 'cache',
						args: [ 'flush' ],
						namedvars: {
							'skip-plugins': true,
							'skip-themes': true,
						},
					})
					.end();
			});
		});
	});

function getGoFilesRelativePath( url, site ) {
	// Parse it down to the pathname
	var parsed = urlUtils.parse( url );

	// If site is multisite, and this is not the primary blog, adjust path accordingly
	if ( site.is_multisite && site.multisite_id ) {

	}

	///// @todo - remove existing /sites/:id part of url, add new sites/:id

	return parsed.pathname;
}

function streamingDownloadErrorHandler( err ) {
	// @todo output to file




	console.log( err );
}

function isAllowedType( file, types, extraTypes ) {
	var ext = file.split( '.' );

	ext = ext[ ext.length - 1 ];

	if ( ! ext || ( types.indexOf( ext.toLowerCase() ) < 0 && extraTypes.indexOf( ext.toLowerCase() ) < 0 ) ) {
		return false;
	}

	return true;
}

/**
 * Determine if the url is importable into VIP Go
 */
function isImportableMediaUrl( url ) {
	var parsed = urlUtils.parse( url );

	if ( 0 !== parsed.pathname.indexOf( '/wp-content/uploads' ) ) {
		return false;
	}

	return true;
}

program.parse( process.argv );
if ( ! process.argv.slice( 2 ).length ) {
	program.outputHelp();
}
