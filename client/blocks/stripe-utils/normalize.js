/* global wc_stripe_payment_request_params */

/**
 * External dependencies
 */
import { getSetting } from '@woocommerce/settings';

/**
 * @typedef {import('./type-defs').StripePaymentItem} StripePaymentItem
 * @typedef {import('./type-defs').StripeShippingOption} StripeShippingOption
 * @typedef {import('./type-defs').StripeShippingAddress} StripeShippingAddress
 * @typedef {import('./type-defs').StripePaymentResponse} StripePaymentResponse
 * @typedef {import('@woocommerce/type-defs/registered-payment-method-props').PreparedCartTotalItem} CartTotalItem
 * @typedef {import('@woocommerce/type-defs/cart').CartShippingOption} CartShippingOption
 * @typedef {import('@woocommerce/type-defs/shipping').ShippingAddress} CartShippingAddress
 * @typedef {import('@woocommerce/type-defs/billing').BillingData} CartBillingAddress
 */

/**
 * Normalizes incoming cart total items for use as a displayItems with the
 * Stripe api.
 *
 * @param {CartTotalItem[]} cartTotalItems CartTotalItems to normalize
 * @param {boolean}         pending        Whether to mark items as pending or
 *                                         not
 *
 * @return {StripePaymentItem[]} An array of PaymentItems
 */
const normalizeLineItems = ( cartTotalItems, pending = false ) => {
	return cartTotalItems
		.filter( ( cartTotalItem ) => {
			return !! cartTotalItem.value;
		} )
		.map( ( cartTotalItem ) => {
			return {
				amount: cartTotalItem.value,
				label: cartTotalItem.label,
				pending,
			};
		} )
		.filter( Boolean );
};

/**
 * Normalizes incoming cart shipping option items for use as shipping options
 * with the Stripe api.
 *
 * @param {CartShippingOption[]}  shippingOptions An array of CartShippingOption items.
 *
 * @return {StripeShippingOption[]}  An array of Stripe shipping option items.
 */
const normalizeShippingOptions = ( shippingOptions ) => {
	const rates = shippingOptions[ 0 ].shipping_rates;
	return rates.map( ( rate ) => {
		return {
			id: rate.rate_id,
			label: rate.name,
			detail: rate.description,
			amount: parseInt( rate.price, 10 ),
		};
	} );
};

/**
 * Normalize the state provided with shipping address information.
 *
 * This is a mirror of `get_normalized_state()` in `class-wc-stripe-payment-request.php`.
 *
 * @param {string} country - The country as a string.
 * @param {string} state   - The state as a string.
 */
const normalizeState = ( country, state ) => {
	// We can't make any intelligent decisions if either state or country are not provided, so we
	// just default to returning the provided state.
	if ( state === '' || country === '' ) {
		return state;
	}

	// This setting is called `allowedStates` on the checkout page and `shippingStates` on the
	// cart page.
	const allowedStates =
		getSetting( 'allowedStates', null ) ??
		getSetting( 'shippingStates', null );
	const validStates = allowedStates?.[ country ] ?? [];

	// If there are no valid states for the provided country, default to returning the provided
	// state.
	if ( validStates.length === 0 ) {
		return state;
	}

	// If the provided state is already normalized, we can safely return it.
	if ( Object.keys( validStates ).includes( state ) ) {
		return state;
	}

	// China - Adapt dropdown values from Chrome and accept manually typed values like 云南.
	// WC states: https://github.com/woocommerce/woocommerce/blob/master/i18n/states.php
	if ( country === 'CN' ) {
		const replacements = {
			// Rename regions with different spelling.
			Macau: 'Macao',
			Neimenggu: 'Inner Mongolia',
			Xizang: 'Tibet',
			// Remove suffixes.
			Shi: '',
			Sheng: '',
			Zizhiqu: '',
			Huizuzizhiqu: '',
			Weiwuerzizhiqu: '',
			Zhuangzuzizhiqu: '',
		};

		// Replace all instances of text not found in the list of accepted WooCommerce states with
		// acceptable alternatives.
		for ( const [ key, value ] of Object.entries( replacements ) ) {
			state = state.replaceAll( key, value );
		}

		// If we find the provided state in the list of valid state values we return the state
		// abbreviation.
		const regex = new RegExp( state, 'i' );
		for ( const [ stateAbbreviation, stateValue ] of Object.entries(
			validStates
		) ) {
			if ( regex.test( stateValue ) ) {
				return stateAbbreviation;
			}
		}
	} else {
		// If we find any of the valid state values in the provided state we return the state
		// abbreviation.
		for ( const [ stateAbbreviation, stateValue ] of Object.entries(
			validStates
		) ) {
			const regex = new RegExp( stateValue, 'i' );
			if ( regex.test( state ) ) {
				return stateAbbreviation;
			}
		}
	}

	// Return the provided state if no abbreviation exists.
	return state;
};

/**
 * Normalize shipping address information from stripe's address object to
 * the cart shipping address object shape.
 *
 * @param {StripeShippingAddress} shippingAddress Stripe's shipping address item
 *
 * @return {CartShippingAddress} The shipping address in the shape expected by
 * the cart.
 */
const normalizeShippingAddressForCheckout = ( shippingAddress ) => {
	return {
		first_name:
			shippingAddress.recipient
				?.split( ' ' )
				?.slice( 0, 1 )
				?.join( ' ' ) ?? '',
		last_name:
			shippingAddress.recipient?.split( ' ' )?.slice( 1 )?.join( ' ' ) ??
			'',
		company: '',
		address_1: shippingAddress.addressLine?.[ 0 ] ?? '',
		address_2: shippingAddress.addressLine?.[ 1 ] ?? '',
		city: shippingAddress.city ?? '',
		state: normalizeState(
			shippingAddress.country ?? '',
			shippingAddress.region ?? ''
		),
		country: shippingAddress.country ?? '',
		postcode: shippingAddress.postalCode?.replace( ' ', '' ) ?? '',
	};
};

/**
 * Normalizes shipping option shape selection from Stripe's shipping option
 * object to the expected shape for cart shipping option selections.
 *
 * @param {StripeShippingOption} shippingOption The customer's selected shipping
 *                                              option.
 *
 * @return {string[]}  An array of ids (in this case will just be one)
 */
const normalizeShippingOptionSelectionsForCheckout = ( shippingOption ) => {
	return shippingOption.id;
};

/**
 * Normalizes order data received upon creating an order using the store's AJAX API.
 *
 * @param {Object} sourceEvent - The source event that triggered the creation of the order.
 * @param {string} paymentRequestType - The payment request type.
 */
const normalizeOrderData = ( sourceEvent, paymentRequestType ) => {
	const { source } = sourceEvent;
	const email = source?.owner?.email;
	const phone = source?.owner?.phone;
	const billing = source?.owner?.address;
	const name = source?.owner?.name;
	const shipping = sourceEvent?.shippingAddress;

	const data = {
		_wpnonce: wc_stripe_payment_request_params.nonce.checkout,
		billing_first_name:
			name?.split( ' ' )?.slice( 0, 1 )?.join( ' ' ) ?? '',
		billing_last_name: name?.split( ' ' )?.slice( 1 )?.join( ' ' ) ?? '',
		billing_company: '',
		billing_email: email ?? sourceEvent?.payerEmail,
		billing_phone:
			phone ?? sourceEvent?.payerPhone?.replace( '/[() -]/g', '' ),
		billing_country: billing?.country ?? '',
		billing_address_1: billing?.line1 ?? '',
		billing_address_2: billing?.line2 ?? '',
		billing_city: billing?.city ?? '',
		billing_state: billing?.state ?? '',
		billing_postcode: billing?.postal_code ?? '',
		shipping_first_name: '',
		shipping_last_name: '',
		shipping_company: '',
		shipping_country: '',
		shipping_address_1: '',
		shipping_address_2: '',
		shipping_city: '',
		shipping_state: '',
		shipping_postcode: '',
		shipping_method: [ sourceEvent?.shippingOption?.id ],
		order_comments: '',
		payment_method: 'stripe',
		ship_to_different_address: 1,
		terms: 1,
		stripe_source: source.id,
		payment_request_type: paymentRequestType,
	};

	if ( shipping ) {
		data.shipping_first_name = shipping?.recipient
			?.split( ' ' )
			?.slice( 0, 1 )
			?.join( ' ' );
		data.shipping_last_name = shipping?.recipient
			?.split( ' ' )
			?.slice( 1 )
			?.join( ' ' );
		data.shipping_company = shipping?.organization;
		data.shipping_country = shipping?.country;
		data.shipping_address_1 = shipping?.addressLine?.[ 0 ] ?? '';
		data.shipping_address_2 = shipping?.addressLine?.[ 1 ] ?? '';
		data.shipping_city = shipping?.city;
		data.shipping_state = shipping?.region;
		data.shipping_postcode = shipping?.postalCode;
	}

	return data;
};

/**
 * Returns the billing data extracted from the stripe payment response to the
 * CartBillingData shape.
 *
 * @param {StripePaymentResponse} paymentResponse Stripe's payment response
 *                                                object.
 *
 * @return {CartBillingAddress} The cart billing data
 */
const getBillingData = ( paymentResponse ) => {
	const source = paymentResponse.source;
	const name = source?.owner?.name;
	const billing = source?.owner?.address;
	const payerEmail = paymentResponse.payerEmail ?? '';
	const payerPhone = paymentResponse.payerPhone ?? '';
	return {
		first_name: name?.split( ' ' )?.slice( 0, 1 )?.join( ' ' ) ?? '',
		last_name: name?.split( ' ' )?.slice( 1 )?.join( ' ' ) ?? '',
		email: source?.owner?.email ?? payerEmail,
		phone: source?.owner?.phone ?? payerPhone.replace( '/[() -]/g', '' ),
		country: billing?.country ?? '',
		address_1: billing?.line1 ?? '',
		address_2: billing?.line2 ?? '',
		city: billing?.city ?? '',
		state: billing?.state ?? '',
		postcode: billing?.postal_code ?? '',
		company: '',
	};
};

/**
 * This returns extra payment method data to add to the payment method update
 * request made by the checkout processor.
 *
 * @param {StripePaymentResponse} paymentResponse    A stripe payment response
 *                                                   object.
 * @param {string}                paymentRequestType The payment request type
 *                                                   used for payment.
 *
 * @return {Object} An object with the extra payment data.
 */
const getPaymentMethodData = ( paymentResponse, paymentRequestType ) => {
	return {
		payment_method: 'stripe',
		stripe_source: paymentResponse.source?.id,
		payment_request_type: paymentRequestType,
	};
};

const getShippingData = ( paymentResponse ) => {
	return paymentResponse.shippingAddress
		? {
				address: normalizeShippingAddressForCheckout(
					paymentResponse.shippingAddress
				),
		  }
		: null;
};

export {
	normalizeLineItems,
	normalizeShippingOptions,
	normalizeShippingAddressForCheckout,
	normalizeShippingOptionSelectionsForCheckout,
	normalizeOrderData,
	getBillingData,
	getPaymentMethodData,
	getShippingData,
};