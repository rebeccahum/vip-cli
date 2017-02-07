global.should = require( 'should' );

if ( process.env.NODE_ENV !== 'test' ) {
	throw new Error( 'Tests require `NODE_ENV=test`; currently `NODE_ENV=' + process.env.NODE_ENV + '`' );
}
