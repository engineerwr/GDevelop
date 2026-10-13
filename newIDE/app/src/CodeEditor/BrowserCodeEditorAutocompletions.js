// @flow

export const setupAutocompletions = (monaco: any): Promise<void> => {
  // The browser cannot read the GDJS source tree with fs as the desktop app
  // does. Load the declarations shipped with the web app for object scripts.
  const declarationsUrl = new URL('gdjs-object-script.d.ts', document.baseURI);
  return fetch(declarationsUrl.toString())
    .then(response => {
      if (!response.ok) {
        throw new Error(`Unable to load GDJS types: ${response.status}`);
      }
      return response.text();
    })
    .then(declarations => {
      const virtualPath = 'file:///gdjs-object-script.d.ts';
      monaco.languages.typescript.javascriptDefaults.addExtraLib(
        declarations,
        virtualPath
      );
      monaco.languages.typescript.typescriptDefaults.addExtraLib(
        declarations,
        virtualPath
      );
    });
};
