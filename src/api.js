const vip = require( 'vip' );
const api = new vip();

const utils = require( './utils' );

utils.getCredentials( function( err, credentials ) {
	if (err) {
		return console.error(err);
	}

	api.auth.apiUserId = credentials.userId;
	api.auth.token = credentials.accessToken;
});

module.exports = api;