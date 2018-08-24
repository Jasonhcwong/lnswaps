// const { parseInvoice } = require('ln-service');
const { generateKeyPair } = require('./generate_key_pair');
const { getAddressDetails } = require('./../../service/get_address_details');

module.exports = { generateKeyPair, getAddressDetails };
window.blockchain = { generateKeyPair, getAddressDetails };
