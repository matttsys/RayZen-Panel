/**
 * Forensic reproducer for the historical setup minifier collision.
 *
 * Source dependency before the workaround:
 *   const setupResponseText = await setupResponse.text();
 *   ...
 *   {
 *     const setupDocument = new DOMParser().parseFromString(setupResponseText, 'text/html');
 *   }
 *
 * The historical minifier reused the same short lexical name in the nested block.
 * Lexical lookup in the initializer then resolves to the *inner* binding, which exists
 * but is still uninitialized: `const t = parseFromString(t, ...)`.
 */
import vm from 'node:vm';

const historicalTransform = `
(async () => {
  const t = '<div id="error-container"><b>failure</b></div>';
  {
    const t = new DOMParser().parseFromString(t, 'text/html');
    return t;
  }
})()
`;

const context = {
  DOMParser: class { parseFromString(value) { return { value }; } }
};

let error;
try {
  await vm.runInNewContext(historicalTransform, context, { filename: 'legacy-rayzen-setup.min.js' });
} catch (caught) {
  error = caught;
}

if (!(error instanceof ReferenceError) && error?.name !== 'ReferenceError') {
  throw new Error(`Expected ReferenceError, got ${error?.name || 'no error'}`);
}
if (!/Cannot access 't' before initialization|Cannot access "t" before initialization/u.test(String(error.message))) {
  throw new Error(`Unexpected ReferenceError: ${error.message}`);
}
console.log(`✔ Historical lexical collision reproduced: ${error.name}: ${error.message}`);
