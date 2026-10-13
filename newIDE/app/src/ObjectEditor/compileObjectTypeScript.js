// @flow

/** Compile a script attached to an object for use in an exported game. */
export const compileObjectTypeScript = async (
  source: string
): Promise<string> => {
  if (!source.trim()) return '';

  // Load the compiler only when a script is edited. The rest of the IDE does
  // not need the TypeScript compiler in its initial bundle.
  const typescriptModule = await import('typescript');
  const ts = typescriptModule.default || typescriptModule;
  const sourceFile = ts.createSourceFile(
    'object-script.ts',
    source,
    ts.ScriptTarget.ES2019,
    true,
    ts.ScriptKind.TS
  );

  // Object scripts are evaluated as one function per instance, so imports and
  // exports have no module loader to resolve them at runtime.
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isImportEqualsDeclaration(statement) ||
      ts.isExportDeclaration(statement) ||
      ts.isExportAssignment(statement) ||
      (statement.modifiers &&
        statement.modifiers.some(
          modifier =>
            modifier.kind === ts.SyntaxKind.ExportKeyword ||
            modifier.kind === ts.SyntaxKind.DefaultKeyword
        ))
    ) {
      throw new Error(
        'Object scripts must define functions without imports or exports.'
      );
    }
  }

  const result = ts.transpileModule(source, {
    fileName: 'object-script.ts',
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2019,
      module: ts.ModuleKind.None,
      removeComments: false,
    },
  });
  const errors = (result.diagnostics || []).filter(
    diagnostic => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (errors.length) {
    throw new Error(
      errors
        .map(diagnostic => {
          const line =
            diagnostic.file && diagnostic.start != null
              ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
                  .line + 1
              : null;
          const message = ts.flattenDiagnosticMessageText(
            diagnostic.messageText,
            '\n'
          );
          return line ? `Line ${line}: ${message}` : message;
        })
        .join('\n')
    );
  }
  return result.outputText;
};
