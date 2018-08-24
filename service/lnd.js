const { lightningDaemon } = require('ln-service');

const { LNSWAP_LND_GRPC_HOST } = process.env;

let lnd;
try {
  lnd = lightningDaemon({
    host: LNSWAP_LND_GRPC_HOST,
  });
} catch (e) {
  console.log('Error initialize connection with lnd:', e);
  throw new Error('FailedToInitializedLightningGrpcApi');
}

/** Get the Lightning Network Daemon connection

  {}

  @throws
  <Error> when daemon credentials are not available

  @returns
  <LND GRPC API Object>
*/
module.exports = {
  lnd,
};
