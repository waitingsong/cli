import { BasePlugin } from '@midwayjs/command-core';
import { resolve, join, dirname, relative } from 'path';
import { existsSync, readFileSync, remove } from 'fs-extra';
import { CompilerHost, Program, resolveTsConfigFile } from '@midwayjs/mwcc';
import { copyFiles } from '@midwayjs/faas-code-analysis';
import * as ts from 'typescript';
export class BuildPlugin extends BasePlugin {
  commands = {
    build: {
      lifecycleEvents: ['clean', 'copyFile', 'compile', 'emit'],
      options: {
        clean: {
          usage: 'clean build target dir',
          shortcut: 'c',
        },
        project: {
          usage: 'project file location',
          shortcut: 'p',
        },
        srcDir: {
          usage: 'source code path',
        },
        entrypoint: {
          usage: 'bundle the source with the file given as entrypoint',
        },
        minify: {
          usage: '',
        },
        mode: {
          usage: 'bundle mode, "debug" or "release" (default)', // release
        },
        tsConfig: {
          usage: 'tsConfig json object data',
        },
      },
    },
  };

  hooks = {
    'build:clean': this.clean.bind(this),
    'build:copyFile': this.copyFile.bind(this),
    'build:compile': this.compile.bind(this),
    'build:emit': this.emit.bind(this),
  };

  private compilerHost: CompilerHost;
  private program: Program;

  async clean() {
    if (!this.options.clean) {
      return;
    }
    const outdir = this.getOutDir();
    if (outdir) {
      await remove(outdir);
    }
  }

  private getOutDir(): string {
    const tsConfig = this.getTsConfig();
    this.core.debug('TSConfig', tsConfig);
    const projectFile = this.getProjectFile();
    this.core.debug('ProjectFile', projectFile);
    return this.getCompilerOptions(tsConfig, 'outDir', dirname(projectFile));
  }

  async copyFile() {
    const targetDir = this.getOutDir();
    this.core.debug('CopyFile TargetDir', targetDir);
    await copyFiles({
      sourceDir: join(this.core.cwd, 'src'),
      targetDir: join(this.core.cwd, targetDir || 'dist'),
      defaultInclude: ['**/*'],
      exclude: ['**/*.ts', '**/*.js'],
      log: path => {
        this.core.cli.log(`   - Copy ${path}`);
      },
    });
  }

  async compile() {
    const { cwd } = this.core;
    const { config } = resolveTsConfigFile(
      cwd,
      undefined,
      undefined,
      this.getStore('mwccHintConfig', 'global'),
      {
        compilerOptions: {
          sourceRoot: this.getTsCodeRoot(),
        },
      }
    );
    this.core.debug('Compile TSConfig', config);
    this.compilerHost = new CompilerHost(cwd, config);
    this.program = new Program(this.compilerHost);
  }

  async emit() {
    const { diagnostics } = await this.program.emit();
    if (!diagnostics || !diagnostics.length) {
      return;
    }
    const error = diagnostics.find(diagnostic => {
      return diagnostic.category === ts.DiagnosticCategory.Error;
    });
    if (error) {
      const errorPath = `(${relative(this.core.cwd, error.file.fileName)})`;
      throw new Error(`TS Error: ${error.messageText}${errorPath}`);
    }
  }

  private getTsCodeRoot(): string {
    return resolve(this.core.cwd, this.options.srcDir || 'src');
  }

  private getCompilerOptions(tsConfig, optionKeyPath, projectDir) {
    // if projectFile extended and without the option,
    // get setting from its parent
    if (tsConfig && tsConfig.extends) {
      if (
        !tsConfig.compilerOptions ||
        (tsConfig.compilerOptions && !tsConfig.compilerOptions[optionKeyPath])
      ) {
        return this.getCompilerOptions(
          require(join(projectDir, tsConfig.extends)),
          optionKeyPath,
          { projectDir }
        );
      }
    }

    return tsConfig?.compilerOptions?.[optionKeyPath];
  }

  private getProjectFile() {
    const { cwd } = this.core;
    const { project } = this.options;
    return resolve(cwd, project || 'tsconfig.json');
  }

  private getTsConfig() {
    const { cwd } = this.core;
    this.core.debug('CWD', cwd);
    const { tsConfig } = this.options;
    let tsConfigResult;
    if (typeof tsConfig === 'string') {
      try {
        tsConfigResult = JSON.parse(tsConfig);
      } catch (e) {
        console.log('[midway-bin] tsConfig should be JSON string or Object');
        throw e;
      }
    }
    const projectFile = this.getProjectFile();
    if (!tsConfigResult) {
      if (!existsSync(projectFile)) {
        console.log(`[ Midway ] tsconfig.json not found in ${cwd}\n`);
        throw new Error('tsconfig.json not found');
      }
      try {
        tsConfigResult = JSON.parse(
          readFileSync(projectFile, 'utf-8').toString()
        );
      } catch (e) {
        console.log('[ Midway ] Read TsConfig Error', e.message);
        throw e;
      }
    }
    return tsConfigResult;
  }
}
