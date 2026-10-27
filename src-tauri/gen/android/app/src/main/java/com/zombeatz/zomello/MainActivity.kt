package com.zombeatz.zomello

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File

/** Launcher icons (activity aliases in AndroidManifest.xml) by style. */
private val ICONS = mapOf("classic" to "IconClassic", "bassdrop" to "IconBassDrop", "partycat" to "IconPartyCat")

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  // Android 17+: reaching your computer (or finding servers) on the home network needs the
  // "local network" permission. The page asks for it when you connect, not at start-up.
  private val localNetworkRequest =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> tellPage(granted) }

  // "Save as board file": the system's Save dialog (Downloads, Drive, …) for a file the page made.
  private var pendingSave: ByteArray? = null
  private val saveRequest =
    registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
      val bytes = pendingSave
      pendingSave = null
      val result = when {
        uri == null || bytes == null -> "cancelled"
        else -> try {
          contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
          "saved"
        } catch (e: Exception) {
          "failed"
        }
      }
      webView?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('zomello-file-saved', { detail: '$result' }))", null
      )
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    keepNotificationAction(intent)
    keepShared(intent)
    keepOpen(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    keepNotificationAction(intent)
    keepShared(intent)
    keepOpen(intent)
  }

  // The My Day widget was tapped: the page opens My Day (takeOpen).
  private var pendingOpen: String? = null

  private fun keepOpen(intent: Intent?) {
    pendingOpen = intent?.getStringExtra("zomelloOpen") ?: return
    webView?.evaluateJavascript("window.dispatchEvent(new Event('zomello-open'))", null)
  }

  // Text or a link shared to Zomello from another app: the page makes a task of it (takeShared).
  private var pendingShare: String? = null

  private fun keepShared(intent: Intent?) {
    if (intent?.action != Intent.ACTION_SEND || intent.type?.startsWith("text/") != true) return
    val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
    pendingShare = org.json.JSONObject()
      .put("text", text)
      .put("subject", intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: "")
      .toString()
    webView?.evaluateJavascript("window.dispatchEvent(new Event('zomello-shared'))", null)
  }

  // A reminder's button (Done, Snooze) or the reminder itself was tapped: Zomello opened for it. The page
  // may not be loaded yet, so keep it until the page asks (takeNotificationAction), and tell it if it's there.
  private var pendingAction: String? = null

  private fun keepNotificationAction(intent: Intent?) {
    val action = intent?.getStringExtra("NotificationUserAction") ?: return
    pendingAction = org.json.JSONObject()
      .put("action", action)
      .put("notification", intent.getStringExtra("LocalNotficationObject"))
      .toString()
    webView?.evaluateJavascript("window.dispatchEvent(new Event('zomello-notification-action'))", null)
  }

  // Sign-ins (pairing with your computer, server accounts) are cookies, which the WebView writes to
  // disk only now and then. Write them whenever the app goes to the background, so they survive.
  override fun onPause() {
    super.onPause()
    CookieManager.getInstance().flush()
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(LocalNetwork(), "ZomelloAndroid")
  }

  private fun localNetworkPermission(): String? =
    if (Build.VERSION.SDK_INT >= 37) "android.permission.ACCESS_LOCAL_NETWORK" else null

  private fun tellPage(granted: Boolean) {
    webView?.evaluateJavascript(
      "window.dispatchEvent(new CustomEvent('zomello-local-network', { detail: $granted }))", null
    )
  }

  /** window.ZomelloAndroid in the page: the local network permission, and saving sign-ins. */
  inner class LocalNetwork {
    @JavascriptInterface
    fun hasLocalNetwork(): Boolean {
      val p = localNetworkPermission() ?: return true
      return ContextCompat.checkSelfPermission(this@MainActivity, p) == PackageManager.PERMISSION_GRANTED
    }

    /** Save sign-in cookies right away (after pairing or signing in). */
    @JavascriptInterface
    fun saveSignIn() {
      CookieManager.getInstance().flush()
    }

    /** Save a file (base64) where the person picks; answers with a 'zomello-file-saved' event. */
    @JavascriptInterface
    fun saveFile(base64: String, name: String) {
      pendingSave = Base64.decode(base64, Base64.DEFAULT)
      runOnUiThread { saveRequest.launch(name) }
    }

    /** Hand a file (base64) to another app: the share sheet (email, chat, Drive…). */
    @JavascriptInterface
    fun shareFile(base64: String, name: String) {
      val dir = File(cacheDir, "shared").apply { mkdirs() }
      val file = File(dir, name.replace(Regex("[\\\\/:*?\"<>|]"), " "))
      file.writeBytes(Base64.decode(base64, Base64.DEFAULT))
      val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", file)
      val send = Intent(Intent.ACTION_SEND).apply {
        type = "application/octet-stream"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      runOnUiThread { startActivity(Intent.createChooser(send, name)) }
    }

    // The aliases live next to MainActivity (its package can differ from the installed app's id).
    private fun iconComponent(alias: String) =
      ComponentName(this@MainActivity, "${MainActivity::class.java.name.substringBeforeLast('.')}.$alias")

    /** The launcher icon: "classic", "bassdrop" or "partycat" (turns on that launcher entry, off the others). */
    @JavascriptInterface
    fun setAppIcon(style: String) {
      val on = ICONS[style] ?: return
      for (alias in ICONS.values) {
        val state = if (alias == on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        val component = iconComponent(alias)
        if (packageManager.getComponentEnabledSetting(component) == state) continue
        packageManager.setComponentEnabledSetting(component, state, PackageManager.DONT_KILL_APP)
      }
    }

    /** The My Day widget's content (see src/widget.ts): saved and drawn on every widget. */
    @JavascriptInterface
    fun updateWidget(json: String) {
      MyDayWidget.save(this@MainActivity, json)
    }

    /** What the widget asked to open ("myday"), once. */
    @JavascriptInterface
    fun takeOpen(): String? {
      val o = pendingOpen
      pendingOpen = null
      return o
    }

    /** Text shared to Zomello, waiting for the page, once: {"text", "subject"}. */
    @JavascriptInterface
    fun takeShared(): String? {
      val s = pendingShare
      pendingShare = null
      return s
    }

    /** A reminder action waiting for the page (see keepNotificationAction), once. */
    @JavascriptInterface
    fun takeNotificationAction(): String? {
      val a = pendingAction
      pendingAction = null
      return a
    }

    /** Which launcher icon is on now. */
    @JavascriptInterface
    fun appIcon(): String {
      for ((style, alias) in ICONS) {
        val s = packageManager.getComponentEnabledSetting(iconComponent(alias))
        if (s == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) return style
      }
      return "classic"
    }

    @JavascriptInterface
    fun requestLocalNetwork() {
      runOnUiThread {
        val p = localNetworkPermission()
        if (p == null || hasLocalNetwork()) tellPage(true) else localNetworkRequest.launch(p)
      }
    }
  }
}
