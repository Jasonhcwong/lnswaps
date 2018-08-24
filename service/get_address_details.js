const bitcoinjslib = require('./../tokenslib');

const publicKeyHashLength = 20;
const witnessScriptHashLength = 32;

/** Derive address details

  {
    address: <Address String>
    network: <Network Name String>
  }

  @returns via cbk
  {
    [data]: <Witness Address Data Hex String>
    [hash]: <Address Hash Data Hex String>
    [prefix]: <Witness Prefix String>
    type: <Address Type String>
    version: <Address Version Number>
  }
*/
module.exports = ({ address, network }, cbk) => {
  if (!address) {
    return cbk([400, 'ExpectedAddress']);
  }

  if (!network || !bitcoinjslib.networks[network]) {
    return cbk([400, 'ExpectedNetworkForAddress']);
  }

  let base58Address;
  let bech32Address;

  try {
    base58Address = bitcoinjslib.address.fromBase58Check(address);
  } catch (e) {
    base58Address = null;
  }

  try {
    bech32Address = bitcoinjslib.address.fromBech32(address);
  } catch (e) {
    bech32Address = null;
  }

  const details = base58Address || bech32Address;

  // Exit early: address does not parse as a bech32 or base58 address
  if (!details) {
    return cbk([400, 'ExpectedValidAddress']);
  }

  const isWitness = details.prefix;
  let type;

  if (isWitness) {
    switch (details.data.length) {
      case publicKeyHashLength:
        type = 'p2wpkh';
        break;

      case witnessScriptHashLength:
        type = 'p2wsh';
        break;

      default:
        return cbk([400, 'UnexpectedWitnessDataLength']);
    }
  } else {
    switch (details.version) {
      case (bitcoinjslib.networks[network].pubKeyHash):
        type = 'p2pkh';
        break;

      case (bitcoinjslib.networks[network].scriptHash):
        type = 'p2sh';
        break;

      default:
        return cbk([400, 'UnknownAddressVersion']);
    }
  }

  return cbk(null, {
    type,
    data: !details.data ? null : details.data.toString('hex'),
    hash: !details.hash ? null : details.hash.toString('hex'),
    prefix: details.prefix,
    version: isWitness ? null : details.version,
  });
};
