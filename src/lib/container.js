// Ours
const api = require( './api' );

export function stopContainer( container, done ) {
	if ( container.state !== 'running' ) {
		return done();
	}

	const url = `/containers/${ container.container_id }/stop`;

	api.post( url )
		.end( ( err, response ) => {
			if ( err ) {
				return done( err );
			}

			done( null, response.body );
		});
}

export function deleteContainer( container, done ) {
	if ( container.state !== 'stopped' ) {
		return done( new Error( 'Cannot delete container that is not in a `stopped` state.' ) );
	}

	const url = `/containers/${ container.container_id }`;

	api.del( url )
		.end( ( err, response ) => {
			if ( err ) {
				return done( err );
			}

			done( null, response.body );
		});
}

export function getDCAllocation( container, done ) {
	const siteId = container.client_site_id;
	const containerTypeId = container.container_type_id;
	const datacenter = container.datacenter;
	const urlActive = `/sites/${ siteId }/allocations?container_type_id=${ containerTypeId }&datacenter=${ datacenter }`;

	const urlInactive = urlActive + '&active=0';

	api.get( urlActive )
		.end( ( err, response ) => {
			if ( err ) {
				return done( err );
			}

			// HACK: Because GET /allocations returns on active=1 by default
			// TODO: Would be nice if it returned the allocation regardless or had a flag for active=any
			if ( ! response.body.data || ! response.body.data.length ) {
				return api.get( urlInactive )
					.end( ( err, response ) => {
						if ( err ) {
							return done( err );
						}

						if ( ! response.body.data || ! response.body.data.length ) {
							return done();
						}

						return done( null, response.body.data[0] );
					});
			}

			done( null, response.body.data[0] );
		});
}

export function addDCAllocation( allocation, done ) {
	const url = '/datacenter_allocations';

	return api.post( url, allocation )
		.end( ( err, response ) => {
			if ( err ) {
				return done( err );
			}

			done( null, response.body );
		});
}

export const updateDCAllocation = ( allocation, done ) => {
	const url = `/datacenter_allocations/${ allocation.datacenter_allocation_id }`;

	return api.put( url, allocation )
		.end( ( err, response ) => {
			if ( err ) {
				return done( err );
			}

			done( null, response.body );
		});
};

export function setDCAllocation( container, newAllocation, done ) {
	const buildAllocationObject = ( container, currentAllocation, newAllocation ) => {
		const existingAllocation = {};
		if ( currentAllocation.datacenter_allocation_id ) {
			existingAllocation.datacenter_allocation_id = currentAllocation.datacenter_allocation_id;
		}

		if ( currentAllocation.min_instances ) {
			existingAllocation.min_instances = currentAllocation.min_instances;
		}

		if ( currentAllocation.max_instances ) {
			existingAllocation.max_instances = currentAllocation.max_instances;
		}

		return Object.assign({
			// all required fields
			client_site_id: container.client_site_id,
			container_type_id: container.container_type_id,
			datacenter: container.datacenter,
			container_image_id: container.container_image_id,
			software_stack_id: container.software_stack_id,
			min_instances: 2,
			max_instances: 10,
		}, existingAllocation, newAllocation );
	};

	getDCAllocation( container, ( err, allocation ) => {
		if ( err ) {
			return done( err );
		}

		if ( ! allocation ) {
			const data = buildAllocationObject( container, {}, newAllocation );
			return addDCAllocation( data, done );
		}

		const data = buildAllocationObject( container, allocation, newAllocation );
		updateDCAllocation( data, done );
	});
}
