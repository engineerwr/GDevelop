// @flow
import * as React from 'react';
import BrowserPreviewErrorDialog from '../BrowserPreview/BrowserPreviewErrorDialog';
import BrowserSWFileSystem from '../BrowserSWFileSystem';
import { findGDJS } from '../../../GameEngineFinder/BrowserS3GDJSFinder';
import assignIn from 'lodash/assignIn';
import {
  type PreviewOptions,
  type PreparePreviewWindowsOptions,
  type PreviewLauncherProps,
} from '../../PreviewLauncher.flow';
import {
  browserPreviewDebuggerServer,
  registerNewPreviewWindow,
  getExistingPreviewWindowForDebuggerId,
} from '../BrowserPreview/BrowserPreviewDebuggerServer';
import Window from '../../../Utils/Window';
import { getGDevelopResourceJwtToken } from '../../../Utils/GDevelopServices/Project';
import { isNativeMobileApp } from '../../../Utils/Platform';
import { getIDEVersionWithHash } from '../../../Version';
import {
  getBrowserSWPreviewBaseUrl,
  getBrowserSWPreviewRootUrl,
  ensureBrowserSWPreviewSession,
} from './BrowserSWPreviewIndexedDB';
import { setEmbeddedGameFramePreviewLocation } from '../../../EmbeddedGame/EmbeddedGameFrame';
import { setGameplayTestFramePreviewLocation } from '../../../GameplayTests/GameplayTestFrame';
import { immediatelyOpenNewPreviewWindow } from '../BrowserPreview/BrowserPreviewWindow';
const gd: libGDevelop = global.gd;

let nextPreviewId = 1;

const prepareExporter = async ({
  isForInGameEdition,
  isForGameplayTest,
}: {
  isForInGameEdition: boolean,
  isForGameplayTest: boolean,
}): Promise<{|
  outputDir: string,
  exporter: gdjsExporter,
  browserSWFileSystem: BrowserSWFileSystem,
|}> => {
  const { gdjsRoot, filesContent } = await findGDJS('preview');
  console.info('[BrowserSWPreviewLauncher] GDJS found in', gdjsRoot);

  const baseUrl = getBrowserSWPreviewBaseUrl();
  const rootUrl = getBrowserSWPreviewRootUrl();
  const outputDir = `${baseUrl}/${
    isForGameplayTest
      ? 'gameplay-test-preview'
      : isForInGameEdition
      ? 'in-game-editor-preview'
      : 'preview'
  }`;

  console.log(
    '[BrowserSWPreviewLauncher] Preview will be served from:',
    outputDir
  );

  const browserSWFileSystem = new BrowserSWFileSystem({
    filesContent,
    rootUrl: `${rootUrl}/`,
  });
  const fileSystem = assignIn(
    new gd.AbstractFileSystemJS(),
    browserSWFileSystem
  );
  const exporter = new gd.Exporter(fileSystem, gdjsRoot);
  exporter.setCodeOutputDirectory(outputDir);

  return {
    exporter,
    outputDir,
    browserSWFileSystem,
  };
};

type State = {|
  error: ?Error,
|};

export default class BrowserSWPreviewLauncher extends React.Component<
  PreviewLauncherProps,
  State
> {
  _lastPreviewedProject: ?gdProject = null;
  _lastPreviewedSceneName: ?string = null;
  _lastPreviewedExternalLayoutName: ?string = null;

  canDoNetworkPreview = (): any => false;

  // $FlowFixMe[missing-local-annot]
  state = {
    error: null,
  };

  closeAllPreviews = () => {
    // This will also close the preview windows themselves.
    browserPreviewDebuggerServer.closeAllConnections();
    this._lastPreviewedProject = null;
    this._lastPreviewedSceneName = null;
    this._lastPreviewedExternalLayoutName = null;
  };

  immediatelyPreparePreviewWindows = (
    options: PreparePreviewWindowsOptions
  ): any => {
    const debuggerIds = options.isForInGameEdition
      ? this.getPreviewDebuggerServer().getExistingEmbeddedGameFrameDebuggerIds()
      : this.getPreviewDebuggerServer().getExistingPreviewDebuggerIds();
    const shouldHotReload = options.hotReload && !!debuggerIds.length;

    // Immediately open windows (otherwise Safari will block the window opening if done after
    // an asynchronous operation).
    const previewWindows =
      shouldHotReload || options.isForInGameEdition
        ? []
        : Array.from({ length: options.numberOfWindows }, () => {
            try {
              return immediatelyOpenNewPreviewWindow(options.project);
            } catch (error) {
              console.error(
                '[BrowserSWPreviewLauncher] Unable to open a new preview window - this window will be ignored:',
                error
              );
              return null;
            }
          }).filter(Boolean);

    return previewWindows;
  };

  launchPreview = async (previewOptions: PreviewOptions): Promise<any> => {
    const {
      project,
      sceneName,
      externalLayoutName,
      eventsBasedObjectType,
      eventsBasedObjectVariantName,
      previewWindows,
    } = previewOptions;
    const previewStartTime = Date.now();
    this.setState({
      error: null,
    });

    const previewId = nextPreviewId++;
    console.log(
      `[BrowserSWPreviewLauncher] Launching preview #${previewId} with options:`,
      previewOptions
    );

    const debuggerIds = previewOptions.isForInGameEdition
      ? this.getPreviewDebuggerServer().getExistingEmbeddedGameFrameDebuggerIds()
      : this.getPreviewDebuggerServer().getExistingPreviewDebuggerIds();
    const shouldHotReload =
      previewOptions.hotReload &&
      !previewOptions.isForGameplayTest &&
      !!debuggerIds.length;
    // Hot reload updates the running scene's data but does not switch scenes.
    // Reload the window when the editor is previewing a different scene.
    const shouldHardReload =
      previewOptions.shouldHardReload ||
      (shouldHotReload &&
        (this._lastPreviewedProject !== project ||
          this._lastPreviewedSceneName !== sceneName ||
          this._lastPreviewedExternalLayoutName !== externalLayoutName));

    try {
      await this.getPreviewDebuggerServer().startServer({
        origin: new URL(getBrowserSWPreviewBaseUrl()).origin,
      });
    } catch (err) {
      // Ignore any error when running the debugger server - the preview
      // can still work without it.
      console.error(
        '[BrowserSWPreviewLauncher] Unable to start the Debugger Server for the preview:',
        err
      );
    }

    try {
      await ensureBrowserSWPreviewSession();

      // The development server serves the editor's index.html for unknown URLs.
      // Navigating to a preview before its service worker is active would open
      // that page instead of the game exported to IndexedDB.
      if (!navigator.serviceWorker) {
        throw new Error('Service workers are required for browser previews.');
      }
      let readinessTimeoutId: ?TimeoutID = null;
      try {
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve, reject) => {
            readinessTimeoutId = setTimeout(
              () =>
                reject(
                  new Error(
                    'The preview service worker did not become ready. Reload the editor and try again.'
                  )
                ),
              10000
            );
          }),
        ]);
      } finally {
        if (readinessTimeoutId) clearTimeout(readinessTimeoutId);
      }

      // An active worker can exist before it has claimed this editor tab.
      // Requests made by an uncontrolled tab go to the development server,
      // which serves the editor instead of the exported preview.
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve, reject) => {
          let controlTimeoutId: ?TimeoutID = null;
          const onControllerChange = () => {
            if (!navigator.serviceWorker.controller) return;
            navigator.serviceWorker.removeEventListener(
              'controllerchange',
              onControllerChange
            );
            if (controlTimeoutId) clearTimeout(controlTimeoutId);
            resolve();
          };
          navigator.serviceWorker.addEventListener(
            'controllerchange',
            onControllerChange
          );
          controlTimeoutId = setTimeout(() => {
            navigator.serviceWorker.removeEventListener(
              'controllerchange',
              onControllerChange
            );
            reject(
              new Error(
                'The preview service worker did not take control of the editor. Reload the editor and try again.'
              )
            );
          }, 10000);
          onControllerChange();
        });
      }

      const {
        exporter,
        outputDir,
        browserSWFileSystem,
      } = await prepareExporter({
        isForInGameEdition: previewOptions.isForInGameEdition,
        isForGameplayTest: !!previewOptions.isForGameplayTest,
      });

      const previewExportOptions = new gd.PreviewExportOptions(
        project,
        outputDir
      );
      previewExportOptions.setLayoutName(sceneName);
      previewExportOptions.setIsDevelopmentEnvironment(Window.isDev());
      previewExportOptions.setIsInGameEdition(
        previewOptions.isForInGameEdition
      );
      previewExportOptions.setEditorId(previewOptions.editorId || '');
      if (externalLayoutName) {
        previewExportOptions.setExternalLayoutName(externalLayoutName);
      }
      if (eventsBasedObjectType) {
        previewExportOptions.setEventsBasedObjectType(eventsBasedObjectType);
        previewExportOptions.setEventsBasedObjectVariantName(
          eventsBasedObjectVariantName || ''
        );
      }

      previewExportOptions.useWindowMessageDebuggerClient();

      const includeFileHashs = this.props.getIncludeFileHashs();
      for (const includeFile in includeFileHashs) {
        const hash = includeFileHashs[includeFile];
        previewExportOptions.setIncludeFileHash(includeFile, hash);
      }

      // TODO Filter according to isForInGameEdition because the first game preview
      // won't necessarily be the first debugger.
      // It doesn't have any side effect because when it wont actually do an hot-reload
      // since the game preview doesn't exist yet.
      if (shouldHotReload) {
        previewExportOptions.setShouldClearExportFolder(shouldHardReload);
        // At hot-reload, the ProjectData are passed into the message.
        // It means that we don't need to write them in a file.
        previewExportOptions.setShouldReloadProjectData(false);
        previewExportOptions.setShouldReloadLibraries(
          previewOptions.shouldReloadLibraries ||
            previewOptions.shouldGenerateScenesEventsCode
        );
        previewExportOptions.setShouldGenerateScenesEventsCode(
          previewOptions.shouldGenerateScenesEventsCode
        );
      }

      previewExportOptions.setFullLoadingScreen(
        previewOptions.fullLoadingScreen
      );

      previewExportOptions.setNativeMobileApp(isNativeMobileApp());
      previewExportOptions.setGDevelopVersionWithHash(getIDEVersionWithHash());
      previewExportOptions.setCrashReportUploadLevel(
        this.props.crashReportUploadLevel
      );
      previewExportOptions.setPreviewContext('preview');
      previewExportOptions.setProjectTemplateSlug(project.getTemplateSlug());

      if (previewOptions.inAppTutorialMessageInPreview) {
        previewExportOptions.setInAppTutorialMessageInPreview(
          previewOptions.inAppTutorialMessageInPreview,
          previewOptions.inAppTutorialMessagePositionInPreview
        );
      }

      if (previewOptions.fallbackAuthor) {
        previewExportOptions.setFallbackAuthor(
          previewOptions.fallbackAuthor.id,
          previewOptions.fallbackAuthor.username
        );
      }
      if (previewOptions.authenticatedPlayer) {
        previewExportOptions.setAuthenticatedPlayer(
          previewOptions.authenticatedPlayer.playerId,
          previewOptions.authenticatedPlayer.playerUsername,
          previewOptions.authenticatedPlayer.playerToken
        );
      }
      if (
        previewOptions.captureOptions &&
        previewOptions.captureOptions.screenshots
      ) {
        previewOptions.captureOptions.screenshots.forEach(screenshot => {
          previewExportOptions.addScreenshotCapture(
            screenshot.delayTimeInSeconds,
            screenshot.signedUrl,
            screenshot.publicUrl
          );
        });
      }
      if (previewOptions.editorCameraState3D) {
        previewExportOptions.setEditorCameraState3D(
          previewOptions.editorCameraState3D.cameraMode,
          previewOptions.editorCameraState3D.positionX,
          previewOptions.editorCameraState3D.positionY,
          previewOptions.editorCameraState3D.positionZ,
          previewOptions.editorCameraState3D.rotationAngle,
          previewOptions.editorCameraState3D.elevationAngle,
          previewOptions.editorCameraState3D.distance
        );
      }
      if (previewOptions.inGameEditorSettings) {
        previewExportOptions.setInGameEditorSettingsJson(
          JSON.stringify(previewOptions.inGameEditorSettings)
        );
      }

      // The token, if any, to be used to read resources on GDevelop Cloud buckets.
      const gdevelopResourceToken = getGDevelopResourceJwtToken();
      if (gdevelopResourceToken)
        previewExportOptions.setGDevelopResourceToken(gdevelopResourceToken);

      console.log(
        `[BrowserSWPreviewLauncher] Exporting project for preview #${previewId}...`
      );
      exporter.exportProjectForPixiPreview(previewExportOptions);

      console.log(
        `[BrowserSWPreviewLauncher] Storing preview files in IndexedDB for preview #${previewId}...`
      );
      await browserSWFileSystem.applyPendingOperations();

      // Fail with a useful error instead of opening the editor's fallback page
      // when the preview route is not handled by the service worker.
      const previewIndexResponse = await fetch(outputDir + '/index.html', {
        cache: 'no-store',
      });
      const previewIndexHtml = await previewIndexResponse.text();
      if (
        !previewIndexResponse.ok ||
        !previewIndexHtml.includes('new gdjs.RuntimeGame')
      ) {
        throw new Error(
          'The preview files were not served by the service worker. Reload the editor and try again.'
        );
      }

      if (previewOptions.isForInGameEdition) {
        setEmbeddedGameFramePreviewLocation({
          previewIndexHtmlLocation: outputDir + '/index.html',
        });
      }

      if (previewOptions.isForGameplayTest) {
        // The preview is shown in (and run by) the gameplay test frame:
        // no window to open.
        setGameplayTestFramePreviewLocation({
          previewIndexHtmlLocation:
            outputDir + '/index.html?previewId=' + previewId,
          // The game window of the frame is fixed at the project
          // resolution: the frame only zooms its display.
          gameResolution: {
            width: project.getGameResolutionWidth(),
            height: project.getGameResolutionHeight(),
          },
        });
      } else if (shouldHotReload) {
        const projectDataElement = new gd.SerializerElement();
        exporter.serializeProjectData(
          project,
          previewExportOptions,
          projectDataElement
        );
        const projectData = JSON.parse(
          gd.Serializer.toJSON(projectDataElement)
        );
        projectDataElement.delete();

        const runtimeGameOptionsElement = new gd.SerializerElement();
        exporter.serializeRuntimeGameOptions(
          previewExportOptions,
          runtimeGameOptionsElement
        );
        const runtimeGameOptions = JSON.parse(
          gd.Serializer.toJSON(runtimeGameOptionsElement)
        );
        runtimeGameOptionsElement.delete();

        if (shouldHardReload) {
          console.log(
            `[BrowserSWPreviewLauncher] Triggering hard reload for preview #${previewId}...`
          );
          debuggerIds.forEach(debuggerId => {
            this.getPreviewDebuggerServer().sendMessage(debuggerId, {
              command: 'hardReload',
              payload: {
                sceneName,
                externalLayoutName: externalLayoutName || '',
              },
            });
          });
        } else {
          console.log(
            `[BrowserSWPreviewLauncher] Triggering hot reload for preview #${previewId}...`
          );
          debuggerIds.forEach(debuggerId => {
            this.getPreviewDebuggerServer().sendMessage(debuggerId, {
              command: 'hotReload',
              payload: {
                shouldReloadResources: previewOptions.shouldReloadResources,
                projectData,
                runtimeGameOptions,
              },
            });
          });
        }

        // Bring the preview window(s) to the front so users immediately see
        // the result of their update.
        debuggerIds.forEach(debuggerId => {
          const previewWindow = getExistingPreviewWindowForDebuggerId(
            debuggerId
          );
          if (previewWindow && !previewWindow.closed) {
            try {
              previewWindow.focus();
            } catch (e) {}
          }
        });
      } else if (previewWindows) {
        if (previewOptions.isForInGameEdition) {
          setEmbeddedGameFramePreviewLocation({
            previewIndexHtmlLocation: outputDir + '/index.html',
          });
        }

        console.log(
          '[BrowserSWPreviewLauncher] Opening new preview window(s)...'
        );
        previewWindows.forEach((previewWindow: WindowProxy) => {
          // Change the HTML file displayed by the preview window so that it starts loading
          // the game.
          previewWindow.location = outputDir + '/index.html';
          try {
            previewWindow.focus();
          } catch (e) {}

          // Register the window so that it can be accessed
          // by the debugger and for the captures to be detected when it closes.
          const debuggerId = registerNewPreviewWindow(previewWindow);
          browserPreviewDebuggerServer.registerCallbacks({
            onErrorReceived: () => {},
            onServerStateChanged: () => {},
            onConnectionClosed: async ({ id }) => {
              if (id !== debuggerId) {
                return;
              }

              if (previewOptions.captureOptions) {
                await this.props.onCaptureFinished(
                  previewOptions.captureOptions
                );
              }
            },
            onConnectionOpened: () => {},
            onConnectionErrored: () => {},
            onHandleParsedMessage: () => {},
          });
        });
      } else {
        throw new Error(
          'Internal error: no preview windows to open and no hot reload to trigger.'
        );
      }

      previewExportOptions.delete();
      exporter.delete();
      if (
        !previewOptions.isForInGameEdition &&
        !previewOptions.isForGameplayTest
      ) {
        this._lastPreviewedProject = project;
        this._lastPreviewedSceneName = sceneName;
        this._lastPreviewedExternalLayoutName = externalLayoutName;
      }

      console.log(
        `[BrowserSWPreviewLauncher] Preview ${previewId} launched successfully in ${Math.ceil(
          Date.now() - previewStartTime
        )}ms.`
      );
    } catch (error) {
      console.error(
        `[BrowserSWPreviewLauncher] Error launching preview ${previewId}:`,
        error
      );
      this.setState({
        error,
      });
      // The gameplay test runner waits for the game to boot: tell it now
      // that it never will.
      if (previewOptions.isForGameplayTest) throw error;
    }
  };

  getPreviewDebuggerServer(): any {
    return browserPreviewDebuggerServer;
  }

  render(): any {
    const { error } = this.state;

    if (error) {
      return (
        <BrowserPreviewErrorDialog
          error={error}
          onClose={() =>
            this.setState({
              error: null,
            })
          }
        />
      );
    }

    return null;
  }
}
