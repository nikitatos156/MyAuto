// Настройка Android-проекта после `npx cap add android` (запускается в GitHub Actions).
// Иконки, заставка, версия, подпись релиза, разрешения.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const APP = path.join(ROOT, 'android/app');
const RES = path.join(APP, 'src/main/res');
const VERSION_NAME = process.env.VERSION_NAME || '1.0.0';
const VERSION_CODE = process.env.VERSION_CODE || '100001';

if (!fs.existsSync(APP)) {
  console.error('android/app не найден — сначала выполните `npx cap add android`');
  process.exit(1);
}

// 1. Иконки и значок уведомлений
const copyDir = (src, dst) => {
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyDir(s, d);
    } else fs.copyFileSync(s, d);
  }
};
copyDir(path.join(ROOT, 'resources/android/res'), RES);
fs.writeFileSync(
  path.join(RES, 'values/ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1B1D22</color>\n</resources>\n`,
);

// 2. Заставка: тёмный фон + иконка по центру вместо стандартной картинки Capacitor
for (const d of fs.readdirSync(RES)) {
  const p = path.join(RES, d, 'splash.png');
  if (d.startsWith('drawable') && fs.existsSync(p)) fs.rmSync(p);
}
fs.mkdirSync(path.join(RES, 'drawable'), { recursive: true });
fs.writeFileSync(
  path.join(RES, 'drawable/splash.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/myauto_splash"/>
    <item android:width="132dp" android:height="132dp" android:gravity="center" android:drawable="@mipmap/ic_launcher_foreground"/>
</layer-list>
`,
);
fs.writeFileSync(
  path.join(RES, 'values/myauto_colors.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="myauto_splash">#0E0F12</color>\n</resources>\n`,
);
const stylesPath = path.join(RES, 'values/styles.xml');
let styles = fs.readFileSync(stylesPath, 'utf8');
if (!styles.includes('windowSplashScreenBackground')) {
  styles = styles.replace(
    /(<style name="AppTheme.NoActionBarLaunch"[^>]*>)/,
    `$1\n        <item name="windowSplashScreenBackground">@color/myauto_splash</item>\n        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>`,
  );
  fs.writeFileSync(stylesPath, styles);
}

// 3. Версия и подпись
const gradlePath = path.join(APP, 'build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${VERSION_CODE}`).replace(/versionName\s+"[^"]*"/, `versionName "${VERSION_NAME}"`);
// Ключ подписи приходит из секретов GitHub (KEYSTORE_FILE, KEYSTORE_PASSWORD) — в репозитории его нет.
if (!gradle.includes('signingConfigs')) {
  gradle = gradle.replace(
    /android\s*\{/,
    `android {
    signingConfigs {
        release {
            storeFile file(System.getenv('KEYSTORE_FILE') ?: 'missing.jks')
            storePassword System.getenv('KEYSTORE_PASSWORD')
            keyAlias System.getenv('KEY_ALIAS') ?: 'myauto'
            keyPassword System.getenv('KEY_PASSWORD') ?: System.getenv('KEYSTORE_PASSWORD')
        }
    }`,
  );
  gradle = gradle.replace(/release\s*\{\s*minifyEnabled/, `release {\n            signingConfig signingConfigs.release\n            minifyEnabled`);
}
fs.writeFileSync(gradlePath, gradle);

// 4. Разрешения
const manifestPath = path.join(APP, 'src/main/AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf8');
const perms = [
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />',
  '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
];
for (const p of perms) {
  const name = p.match(/android:name="([^"]+)"/)[1];
  if (!manifest.includes(`"${name}"`)) manifest = manifest.replace('</manifest>', `    ${p}\n</manifest>`);
}
if (!manifest.includes('requestLegacyExternalStorage')) {
  manifest = manifest.replace('<application', '<application\n        android:requestLegacyExternalStorage="true"');
}
fs.writeFileSync(manifestPath, manifest);

// 5. Нативная часть My Auto: плагин (виджет + отпечаток), виджет рабочего стола, регистрация плагина
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8')).appId;
const SRC = path.join(ROOT, 'scripts/android');
const javaDir = path.join(APP, 'src/main/java', ...PKG.split('.'));
fs.mkdirSync(javaDir, { recursive: true });
for (const f of fs.readdirSync(javaDir)) if (/^MainActivity\.(java|kt)$/.test(f)) fs.rmSync(path.join(javaDir, f));
for (const f of fs.readdirSync(path.join(SRC, 'java'))) {
  fs.writeFileSync(path.join(javaDir, f), fs.readFileSync(path.join(SRC, 'java', f), 'utf8').replaceAll('__PKG__', PKG));
}
copyDir(path.join(SRC, 'res'), RES);

gradle = fs.readFileSync(gradlePath, 'utf8');
if (!gradle.includes('androidx.biometric:biometric')) {
  const i = gradle.lastIndexOf('dependencies {');
  if (i < 0) throw new Error('В app/build.gradle не найден блок dependencies');
  const at = i + 'dependencies {'.length;
  gradle = gradle.slice(0, at) + '\n    implementation "androidx.biometric:biometric:1.1.0"' + gradle.slice(at);
  fs.writeFileSync(gradlePath, gradle);
}

manifest = fs.readFileSync(manifestPath, 'utf8');
if (!manifest.includes('MyAutoWidget')) {
  manifest = manifest.replace(
    '</application>',
    `    <receiver android:name=".MyAutoWidget" android:exported="false" android:label="My Auto">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/myauto_widget_info" />
        </receiver>
    </application>`,
  );
  fs.writeFileSync(manifestPath, manifest);
}

console.log(`Android подготовлен: ${VERSION_NAME} (${VERSION_CODE}), пакет ${PKG}`);
