const { generateMnemonic, mnemonicToSeed, validateMnemonic } = require('bip39');

const bitcoinjslib = require('./../tokenslib');

const minIndex = 0;
const maxIndex = 4294967295;
const { LNSWAP_CLAIM_BIP39_SEED } = process.env;

/** Server swap key pair

  {
    index: <Key Index Number>
    network: <Network Name String>
  }

  @throws
  <Error> on invalid index or network

  @returns
  {
    p2pkh_address: <Pay to Public Key Hash Base58 Address String>
    p2wpkh_address: <Pay to Witness Public Key Hash Bech32 Address String>
    pk_hash: <Public Key Hash String>
    private_key: <Private Key WIF Encoded String>
    public_key: <Public Key Hex String>
  }
*/
module.exports = ({ index, network }) => {
  if (!validateMnemonic(LNSWAP_CLAIM_BIP39_SEED)) {
    console.log([500, 'ExpectedValidMnemonic', generateMnemonic()]);
    process.exit();
  }

  if (index === undefined || index < minIndex || index > maxIndex) {
    throw new Error('ExpectedValidIndex');
  }

  if (!network || !bitcoinjslib.networks[network]) {
    throw new Error('ExpectedValidNetwork');
  }

  const seed = mnemonicToSeed(LNSWAP_CLAIM_BIP39_SEED);

  const root = bitcoinjslib.HDNode.fromSeedBuffer(seed, bitcoinjslib.networks[network]);

  const { keyPair } = root.derivePath(`m/0'/0/${index}`);

  const publicKeyHash = bitcoinjslib.crypto.hash160(keyPair.getPublicKeyBuffer());

  // SegWit P2PWKH Output Script
  const witnessOutput = bitcoinjslib.script.witnessPubKeyHash.output.encode(publicKeyHash);

  const p2wpkhAddress = bitcoinjslib.address.fromOutputScript(witnessOutput,
    bitcoinjslib.networks[network]);

  return {
    p2pkh_address: keyPair.getAddress(),
    p2wpkh_address: p2wpkhAddress,
    pk_hash: publicKeyHash.toString('hex'),
    private_key: keyPair.toWIF(),
    public_key: keyPair.getPublicKeyBuffer().toString('hex'),
  };
};
