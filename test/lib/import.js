const imports = require( '../../build/lib/import' );

describe( 'isAllowedType', () => {
	it( 'should correctly allow valid file types', () => {
		var allowed = [
			'jpg',
			'png',
			'pdf',
		];

		imports.isAllowedType( 'jpg', allowed, [] ).should.equal( true );
		imports.isAllowedType( 'png', allowed, [] ).should.equal( true );
	});

	it( 'should correctly allow valid file types defined in \'extra types\'', () => {
		var allowed = [
			'jpg',
			'png',
			'pdf',
		];

		var extra = [
			'csv',
		];

		imports.isAllowedType( 'csv', allowed, extra ).should.equal( true );
	});

	it( 'should correctly block invalid file types', () => {
		var allowed = [
			'jpg',
			'png',
			'pdf',
		];

		var extra = [
			'csv',
		];

		imports.isAllowedType( 'exe', allowed, [] ).should.equal( false, extra );
		imports.isAllowedType( 'flv', allowed, [] ).should.equal( false, extra );
	});
});
