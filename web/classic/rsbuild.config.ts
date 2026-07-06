import fs from 'node:fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workspaceRequire = createRequire(path.resolve(__dirname, '../package.json'))
const resolveWorkspacePackageDir = (
  packageName: string,
  resolver = workspaceRequire,
) => {
  let current = path.dirname(resolver.resolve(packageName))
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current
    }
    current = path.dirname(current)
  }
  throw new Error(`Unable to resolve package root for ${packageName}`)
}
const semiUiDir = resolveWorkspacePackageDir('@douyinfe/semi-ui')
const semiFoundationDir = resolveWorkspacePackageDir('@douyinfe/semi-foundation')
const semiFoundationRequire = createRequire(
  path.join(semiFoundationDir, 'package.json'),
)
const semiDateFnsDir = resolveWorkspacePackageDir(
  'date-fns',
  semiFoundationRequire,
)
const reactDir = resolveWorkspacePackageDir('react')
const reactDomDir = resolveWorkspacePackageDir('react-dom')
const lobehubIconsDir = resolveWorkspacePackageDir('@lobehub/icons')

export default defineConfig(({ envMode }) => {
  const env = loadEnv({ mode: envMode, prefixes: ['VITE_'] })
  const clientServerUrl =
    process.env.VITE_REACT_APP_SERVER_URL ||
    env.rawPublicVars.VITE_REACT_APP_SERVER_URL ||
    ''
  const proxyServerUrl =
    clientServerUrl ||
    'http://localhost:3000'
  const isProd = envMode === 'production'
  const devProxy = Object.fromEntries(
    (['/api', '/mj', '/pg'] as const).map((key) => [
      key,
      { target: proxyServerUrl, changeOrigin: true },
    ]),
  ) as Record<string, { target: string; changeOrigin: boolean }>

  return {
    plugins: [pluginReact()],
    source: {
      entry: {
        index: './src/index.jsx',
      },
      define: {
        'import.meta.env.VITE_REACT_APP_SERVER_URL': JSON.stringify(
          clientServerUrl,
        ),
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@douyinfe/semi-ui/dist/css/semi.css': path.resolve(
          semiUiDir,
          'dist/css/semi.css',
        ),
        '@douyinfe/semi-ui': semiUiDir,
        '@lobehub/icons': lobehubIconsDir,
        'date-fns': semiDateFnsDir,
        react: reactDir,
        'react-dom': reactDomDir,
      },
    },
    html: {
      template: './index.html',
    },
    server: {
      host: '0.0.0.0',
      strictPort: false,
      proxy: devProxy,
    },
    output: {
      minify: isProd,
      target: 'web',
      distPath: {
        root: 'dist',
      },
    },
    performance: {
      removeConsole: isProd ? ['log'] : false,
      buildCache: {
        cacheDigest: [process.env.VITE_REACT_APP_VERSION],
      },
    },
    tools: {
      rspack: {
        module: {
          rules: [
            {
              test: /src[\\/].*\.js$/,
              type: 'javascript/auto',
              use: [
                {
                  loader: 'builtin:swc-loader',
                  options: {
                    jsc: {
                      parser: {
                        syntax: 'ecmascript',
                        jsx: true,
                      },
                      transform: {
                        react: {
                          runtime: 'automatic',
                          development: !isProd,
                          refresh: !isProd,
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    },
  }
})
