import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { build, type Options } from 'tsup';

const distDir = path.join(__dirname, '..', '..', 'dist');
const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
const configSourcePath = path.join(__dirname, '..', 'mcp', 'stdio-config.json');
const configDestPath = path.join(distDir, 'mcp', 'stdio-config.json');
const scriptsSourceDir = path.join(__dirname, '.');

export function createBundleArgs(): string[] {
  return [
    'src/index.ts',
    'src/cli.ts',
    'src/scripts/register-dev.ts',
    'src/scripts/postinstall.ts',
  ];
}

export function createBundleCommand(): string {
  return `tsup.build(${createBundleArgs().join(', ')})`;
}

export function createBundleOptions(packageDependencies: string[]): Options {
  return {
    entry: {
      index: 'src/index.ts',
      cli: 'src/cli.ts',
      'scripts/register-dev': 'src/scripts/register-dev.ts',
      'scripts/postinstall': 'src/scripts/postinstall.ts',
    },
    outDir: 'dist',
    platform: 'node',
    format: ['cjs'],
    sourcemap: true,
    clean: true,
    noExternal: packageDependencies,
  };
}

function prepareDistDir() {
  console.log('清理上次构建...');
  if (process.platform === 'win32') {
    console.log('Windows: preserving dist directory to avoid native host file locks.');
  } else {
    try {
      fs.rmSync(distDir, { recursive: true, force: true });
    } catch (err) {
      console.log(err);
    }
  }

  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(path.join(distDir, 'logs'), { recursive: true });
  console.log('dist 和 dist/logs 目录已创建/确认存在');
}

function runTypecheck() {
  console.log('执行 TypeScript 类型检查...');
  execSync('tsc --noEmit', { stdio: 'inherit' });
}

async function runBundleBuild() {
  console.log('打包 native-server 运行入口...');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  await build(createBundleOptions(Object.keys(packageJson.dependencies ?? {})));
}

function copyConfigFile() {
  console.log('复制配置文件...');
  try {
    fs.mkdirSync(path.dirname(configDestPath), { recursive: true });

    if (fs.existsSync(configSourcePath)) {
      fs.copyFileSync(configSourcePath, configDestPath);
      console.log(`已将 stdio-config.json 复制到 ${configDestPath}`);
    } else {
      console.error(`错误: 配置文件未找到: ${configSourcePath}`);
    }
  } catch (error) {
    console.error('复制配置文件时出错:', error);
  }
}

function writeReadme() {
  console.log('准备 package 元数据...');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name: string };
  const readmeContent = `# ${packageJson.name}

本程序为Chrome扩展的Native Messaging主机端。

## 安装说明

1. 确保已安装Node.js
2. 全局安装本程序:
   \`\`\`
   npm install -g ${packageJson.name}
   \`\`\`
3. 注册Native Messaging主机:
   \`\`\`
   # 用户级别安装（推荐）
   ${packageJson.name} register

   # 如果用户级别安装失败，可以尝试系统级别安装
   ${packageJson.name} register --system
   # 或者使用管理员权限
   sudo ${packageJson.name} register
   \`\`\`

## 使用方法

此应用程序由Chrome扩展自动启动，无需手动运行。
`;

  fs.writeFileSync(path.join(distDir, 'README.md'), readmeContent);
}

function copyWrapperScripts() {
  console.log('复制包装脚本...');
  const macOsWrapperSourcePath = path.join(scriptsSourceDir, 'run_host.sh');
  const windowsWrapperSourcePath = path.join(scriptsSourceDir, 'run_host.bat');

  const macOsWrapperDestPath = path.join(distDir, 'run_host.sh');
  const windowsWrapperDestPath = path.join(distDir, 'run_host.bat');

  try {
    if (fs.existsSync(macOsWrapperSourcePath)) {
      fs.copyFileSync(macOsWrapperSourcePath, macOsWrapperDestPath);
      console.log(`已将 ${macOsWrapperSourcePath} 复制到 ${macOsWrapperDestPath}`);
    } else {
      console.error(`错误: macOS 包装脚本源文件未找到: ${macOsWrapperSourcePath}`);
    }

    if (fs.existsSync(windowsWrapperSourcePath)) {
      fs.copyFileSync(windowsWrapperSourcePath, windowsWrapperDestPath);
      console.log(`已将 ${windowsWrapperSourcePath} 复制到 ${windowsWrapperDestPath}`);
    } else {
      console.error(`错误: Windows 包装脚本源文件未找到: ${windowsWrapperSourcePath}`);
    }
  } catch (error) {
    console.error('复制包装脚本时出错:', error);
  }
}

function markExecutables() {
  console.log('添加可执行权限...');
  const filesToMakeExecutable = ['index.js', 'cli.js', 'run_host.sh'];

  filesToMakeExecutable.forEach((file) => {
    const filePath = path.join(distDir, file);
    try {
      if (fs.existsSync(filePath)) {
        fs.chmodSync(filePath, '755');
        console.log(`已为 ${file} 添加可执行权限 (755)`);
      } else {
        console.warn(`警告: ${filePath} 不存在，无法添加可执行权限`);
      }
    } catch (error) {
      console.error(`为 ${file} 添加可执行权限时出错:`, error);
    }
  });
}

export async function buildDist() {
  prepareDistDir();
  runTypecheck();
  await runBundleBuild();
  copyConfigFile();
  writeReadme();
  copyWrapperScripts();
  markExecutables();
  console.log('✅ 构建完成');
}

if (require.main === module) {
  void buildDist();
}
