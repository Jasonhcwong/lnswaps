const bitcoinjslib = require('./../tokenslib');

const encodeScriptHash = bitcoinjslib.script.scriptHash.output.encode;

/** Given a pkhash swap script, its details.

  {
    network: <Network Name String>
    script: <Redeem Script Hex String>
  }

  @throws
  <Error> on failure to derive swap details

  @returns
  {
    destination_public_key: <Claim Public Key Hex String>
    p2sh_address: <Pay to Script Hash Base58 Address String>
    p2sh_output_script: <Pay to Script Hash Output Hex String>
    [p2sh_p2wsh_address]: <Nested Pay to Witness Script Address String>
    [p2sh_p2wsh_output_script]: <P2SH Nested Output Script Hex String>
    [p2wsh_address]: <Pay to Witness Script Hash Address String>
    payment_hash: <Payment Hash Hex String>
    [refund_p2pkh_address]: <Refund P2PKH Address>
    [refund_p2wpkh_address]: <Refund P2WPKH Address String>
    [refund_public_key_hash]: <Refund Public Key Hash Hex String>
    timelock_block_height: <Locked Until Height Number>
    witness_output_script: <Witness Output Script Hex String>
  }
*/
module.exports = (args) => {
  if (!args.network) {
    throw new Error('ExpectedNetworkNameForScriptDetails');
  }

  if (!bitcoinjslib.networks[args.network]) {
    throw new Error('ExpectedKnownNetworkDetails');
  }

  if (!args.script) {
    throw new Error('ExpectedRedeemScript');
  }

  let cltv;
  let destinationPublicKey;
  const network = bitcoinjslib.networks[args.network];
  let paymentHash;
  const redeemScript = Buffer.from(args.script, 'hex');

  const scriptAssembly = bitcoinjslib.script.toASM(bitcoinjslib.script.decompile(redeemScript)).split(' ');

  // Public key hash swap script
  if (scriptAssembly.length === 17) {
    const [
      OP_DUP,
      OP_SHA256, pkhPaymentHash, OP_EQUAL,
      OP_IF,
      OP_DROP,
      pkhDestinationPublicKey,
      OP_ELSE,
      pkhCltv, OP_CHECKLOCKTIMEVERIFY, OP_DROP2,
      OP_DUP2, OP_HASH160, pkhRefundPublicKeyHash, OP_EQUALVERIFY,
      OP_ENDIF,
      OP_CHECKSIG,
    ] = scriptAssembly;

    if (OP_DUP !== 'OP_DUP') {
      throw new Error('ExpectedInitialOpDup');
    }

    if (OP_SHA256 !== 'OP_SHA256') {
      throw new Error('ExpectedSha256');
    }

    if (!pkhPaymentHash || pkhPaymentHash.length !== 32 * 2) {
      throw new Error('ExpectedStandardPaymentHash');
    }

    paymentHash = pkhPaymentHash;

    if (OP_EQUAL !== 'OP_EQUAL') {
      throw new Error('ExpectedOpEqual');
    }

    if (OP_IF !== 'OP_IF') {
      throw new Error('ExpectedOpIf');
    }

    if (OP_DROP !== 'OP_DROP') {
      throw new Error('ExpectedOpDrop');
    }

    if (!pkhDestinationPublicKey || pkhDestinationPublicKey.length !== 66) {
      throw new Error('ExpectedDestinationKey');
    }

    destinationPublicKey = pkhDestinationPublicKey;

    if (OP_ELSE !== 'OP_ELSE') {
      throw new Error('ExpectedOpElse');
    }

    if (!pkhCltv) {
      throw new Error('ExpectedCltv');
    }

    cltv = pkhCltv;

    if (OP_CHECKLOCKTIMEVERIFY !== 'OP_CHECKLOCKTIMEVERIFY') {
      throw new Error('ExpectedOpCltv');
    }

    if (OP_DROP2 !== 'OP_DROP') {
      throw new Error('ExpectedOpDrop');
    }

    if (OP_DUP2 !== 'OP_DUP') {
      throw new Error('ExpectedOpDup');
    }

    if (OP_HASH160 !== 'OP_HASH160') {
      throw new Error('ExpectedOpHash160');
    }

    if (!pkhRefundPublicKeyHash || pkhRefundPublicKeyHash.length !== 20 * 2) {
      throw new Error('ExpectedRefundPublicKeyHash');
    }

    if (OP_EQUALVERIFY !== 'OP_EQUALVERIFY') {
      throw new Error('ExpectedOpEqualVerify');
    }

    if (OP_ENDIF !== 'OP_ENDIF') {
      throw new Error('ExpectedOpEndIf');
    }

    if (OP_CHECKSIG !== 'OP_CHECKSIG') {
      throw new Error('ExpectedCheckSig');
    }
  } else {
    throw new Error('InvalidScriptLength');
  }

  // Legacy P2SH output script
  const p2shLegacyOutput = encodeScriptHash(bitcoinjslib.crypto.hash160(redeemScript));

  const witnessProgram = bitcoinjslib.script.witnessScriptHash.output.encode(
    bitcoinjslib.crypto.sha256(redeemScript),
  );

  const p2shWrappedWitnessProg = encodeScriptHash(bitcoinjslib.crypto.hash160(witnessProgram));

  const p2shNestedAddr = bitcoinjslib.address.fromOutputScript(p2shWrappedWitnessProg, network);

  const lockHeight = Buffer.from(cltv, 'hex').readUIntLE(0, cltv.length / 2);

  return {
    destination_public_key: destinationPublicKey,
    p2sh_address: bitcoinjslib.address.fromOutputScript(p2shLegacyOutput, network),
    p2sh_output_script: p2shLegacyOutput.toString('hex'),
    p2sh_p2wsh_address: p2shNestedAddr,
    p2sh_p2wsh_output_script: p2shWrappedWitnessProg.toString('hex'),
    p2wsh_address: bitcoinjslib.address.fromOutputScript(witnessProgram, network),
    payment_hash: paymentHash,
    timelock_block_height: lockHeight,
    witness_output_script: witnessProgram.toString('hex'),
  };
};
