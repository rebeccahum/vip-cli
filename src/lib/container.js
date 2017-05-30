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
			// TODO: Would be nice if it returned the allocation regardless or had a flag for active='any'
			if ( ! response.body.data || ! response.body.data.length ) {
				return api.get( urlInactive )
					.end( ( err, response ) => {
						return done( err, response );
					});
			}

			done( null, response );
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
		const { datacenter_allocation_id, min_instances, max_instances } = currentAllocation;

		return Object.assign({
			// all required fields
			client_site_id: container.client_site_id,
			container_type_id: container.container_type_id,
			datacenter: container.datacenter,
			container_image_id: container.container_image_id,
			software_stack_id: container.software_stack_id,
			min_instances: 2,
			max_instances: 10,
		}, { datacenter_allocation_id, min_instances, max_instances }, newAllocation );
	};

	getDCAllocation( container, ( err, response ) => {
		if ( err ) {
			return done( err );
		}

		const allocation = response.body.data;
		if ( ! allocation || ! allocation.length ) {
			const data = buildAllocationObject( container, {}, newAllocation );
			return addDCAllocation( data, done );
		}

		const currentAllocation = allocation[0];
		const data = buildAllocationObject( container, currentAllocation, newAllocation );
		updateDCAllocation( data, done );
	});
}
