import testnet from 'hyperdht/testnet.js';
export async function localDHT() {
  const network = await testnet(3);
  return { bootstrap: network.bootstrap.map(p => `${p.host}:${p.port}`), close: () => network.destroy() };
}
