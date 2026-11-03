// A product's package.json and npm lockfile (v3) for the library update tests: the structure of
// the-bridge-company/art-print-shop's files, its library entries as npm wrote them, and @bridge-ds/react 1.8.4 from the registry.
import type { RegistryManifest } from './library-update';

export const PKG = {
  name: 'bridge-product-admin',
  version: '0.1.0',
  private: true,
  dependencies: { '@bridge-ds/react': '^1.8.2', '@bridge-ds/tokens': '^1.6.0', '@bridge-ds/toolbar': '^0.7.0', react: '18.3.1', 'react-dom': '18.3.1' },
  devDependencies: { typescript: '5.9.3' },
};

export const LOCK = {
  name: 'bridge-product-admin',
  version: '0.1.0',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name: 'bridge-product-admin', version: '0.1.0', license: 'FSL-1.1-MIT', dependencies: PKG.dependencies, devDependencies: PKG.devDependencies, engines: { node: '>=20.19.0' } },
    'node_modules/@bridge-ds/core': {
      version: '0.27.1',
      resolved: 'https://registry.npmjs.org/@bridge-ds/core/-/core-0.27.1.tgz',
      integrity: 'sha512-core',
      license: 'MIT',
      dependencies: { typescript: '5.9.3' },
    },
    'node_modules/@bridge-ds/react': {
      version: '1.8.3',
      resolved: 'https://registry.npmjs.org/@bridge-ds/react/-/react-1.8.3.tgz',
      integrity: 'sha512-old',
      license: 'MIT',
      dependencies: { '@base-ui/react': '1.9.0', '@bridge-ds/tokens': '^1.6.0', '@dicebear/collection': '9.4.3', '@dicebear/core': '9.4.3', 'lucide-react': '1.58.0' },
      peerDependencies: { react: '>=18', 'react-dom': '>=18' },
    },
    'node_modules/@bridge-ds/react/node_modules/@base-ui/react': { version: '1.9.0', resolved: 'https://registry.npmjs.org/@base-ui/react/-/react-1.9.0.tgz', integrity: 'sha512-base', license: 'MIT' },
    'node_modules/@bridge-ds/tokens': { version: '1.6.0', resolved: 'https://registry.npmjs.org/@bridge-ds/tokens/-/tokens-1.6.0.tgz', integrity: 'sha512-tokens', license: 'MIT' },
    'node_modules/@bridge-ds/toolbar': {
      version: '0.7.0',
      resolved: 'https://registry.npmjs.org/@bridge-ds/toolbar/-/toolbar-0.7.0.tgz',
      integrity: 'sha512-toolbar',
      license: 'MIT',
      dependencies: { '@bridge-ds/core': '^0.27.0', 'lucide-react': '1.58.0' },
      peerDependencies: { '@bridge-ds/react': '>=1.8.3', react: '>=18', 'react-dom': '>=18' },
    },
    'node_modules/react': { version: '18.3.1', resolved: 'https://registry.npmjs.org/react/-/react-18.3.1.tgz', integrity: 'sha512-react', license: 'MIT' },
  },
};

export const LOCK_TEXT = `${JSON.stringify(LOCK, null, 2)}\n`;
export const PKG_TEXT = `${JSON.stringify(PKG, null, 2)}\n`;

/** @bridge-ds/react 1.8.4 as the registry has it: the same dependencies as 1.8.3, keys in another order. */
export const REACT_184: RegistryManifest = {
  name: '@bridge-ds/react',
  version: '1.8.4',
  license: 'MIT',
  dist: { tarball: 'https://registry.npmjs.org/@bridge-ds/react/-/react-1.8.4.tgz', integrity: 'sha512-new' },
  dependencies: { 'lucide-react': '1.58.0', '@base-ui/react': '1.9.0', '@dicebear/core': '9.4.3', '@bridge-ds/tokens': '^1.6.0', '@dicebear/collection': '9.4.3' },
  peerDependencies: { react: '>=18', 'react-dom': '>=18' },
};

