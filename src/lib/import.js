const fs = require( 'fs' );
const http = require( 'http' );
const urlUtils = require( 'url' );

export function upload( site, file, token, cb ) {
	fs.readFile( file, ( err, data ) => {
		var filepath = file.split( 'uploads' );
		var req = http.request({
			hostname: 'files.vipv2.net',
			method: 'PUT',
			path: '/wp-content/uploads' + filepath[1],
			headers: {
				'X-Client-Site-ID': site.client_site_id,
				'X-Access-Token': token,
			},
		}, cb );

		req.on( 'socket', function ( socket ) {
			socket.setTimeout( 10000 );
			socket.on( 'timeout', function() {
				req.abort();
			});
		});

		req.write( data );
		req.end();
	});
}

export function queueDir( dir, offset, cb ) {
	var priority = 0 - dir.split( '/' ).length;

	fs.readdir( dir, ( err, files ) => {
		if ( files.length - offset < 10000 ) {
			// If there are less than 2 full rounds of files left, just do them all now
			files = files.slice( offset, offset + 10000 );
			files = files.map( f => dir + '/' + f );

			return cb( [{
				item: files,
				priority: priority,
			}] );
		}

		// Queue next 5k files
		files = files.slice( offset, offset + 5000 );
		offset += 5000;

		// Queue files with absolute path
		files = files.map( f => dir + '/' + f );

		var ptr = 'ptr:' + offset + ':' + dir;
		return cb( [
			{
				priority: priority,
				item: files,
			},
			{
				// Process the pointer after this batch of files
				priority: priority + 1,
				item: ptr,
			},
		] );
	});
}

export function isAllowedType( file, types, extraTypes ) {
	var ext = file.split( '.' );

	ext = ext[ ext.length - 1 ];

	if ( ! ext || ( types.indexOf( ext.toLowerCase() ) < 0 && extraTypes.indexOf( ext.toLowerCase() ) < 0 ) ) {
		return false;
	}

	return true;
}

export function getGoFilesRelativePath( url, site ) {
	// Parse it down to the pathname
	var parsed = urlUtils.parse( url );

	var relative = parsed.pathname;

	// If site is multisite, and this is not the primary blog, adjust path accordingly
	if ( site.is_multisite && site.multisite_id ) {
		// do stuff
		relative = null;
	}

	///// @todo - remove existing /sites/:id part of url, add new sites/:id

	return relative;
}

export function streamingDownloadErrorHandler( err ) {
	// @todo output to file




	console.log( err );
}

/**
 * Determine if the url is importable into VIP Go
 */
export function isImportableMediaUrl( url ) {
	var parsed = urlUtils.parse( url );

	if ( 0 !== parsed.pathname.indexOf( '/wp-content/uploads' ) ) {
		return false;
	}

	return true;
}
