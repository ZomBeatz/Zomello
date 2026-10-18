package com.zombeatz.zomello

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

    @JavascriptInterface
    fun requestLocalNetwork() {
      runOnUiThread {
        val p = localNetworkPermission()
        if (p == null || hasLocalNetwork()) tellPage(true) else localNetworkRequest.launch(p)
      }
    }
  }
}
