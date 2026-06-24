import java.util.Properties
import java.io.FileInputStream

plugins {
    alias(libs.plugins.android.application)
}

// Load release signing credentials from ../keystore.properties (gitignored).
// Falls back to debug signing if the file is absent — CI/devs without the keystore
// can still build release without errors. See keystore.properties.example.
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        load(FileInputStream(keystorePropertiesFile))
    }
}

android {
    namespace = "studio.hodgepodge.snakeball"
    compileSdk = 35

    defaultConfig {
        applicationId = "studio.hodgepodge.snakeball"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        // AdMob app ID injected into AndroidManifest via ${admobAppId}.
        // Default (debug) = Google's official TEST app id so QA builds never touch a
        // real account. The release buildType below overrides it.
        // Keep this consistent with the ad UNIT ids gated by BuildConfig.DEBUG in MainActivity.
        manifestPlaceholders["admobAppId"] = "ca-app-pub-3940256099942544~3347511713"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            if (keystorePropertiesFile.exists()) {
                val props = keystoreProperties
                val storeFilePath = props["storeFile"] as? String
                if (storeFilePath != null) {
                    storeFile = rootProject.file(storeFilePath)
                }
                storePassword = props["storePassword"] as? String
                keyAlias = props["keyAlias"] as? String
                keyPassword = props["keyPassword"] as? String
            }
        }
    }

    buildTypes {
        release {
            // TODO: replace with real AdMob app id before release
            manifestPlaceholders["admobAppId"] = "ca-app-pub-3940256099942544~3347511713"
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Only sign with the release keystore when keystore.properties exists; otherwise
            // fall back to debug signing so local builds don't fail without the keystore.
            signingConfig = if (keystorePropertiesFile.exists()) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.webkit)
    implementation(libs.billing.ktx)
    implementation(libs.play.services.ads)
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
