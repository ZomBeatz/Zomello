package com.zombeatz.zomello

import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  // Android 17+: reaching your computer (or finding servers) on the home network needs the
  // "local network" permission. The page asks for it when you connect, not at start-up.
  private val localNetworkRequest =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> tellPage(granted) }

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

    @JavascriptInterface
    fun requestLocalNetwork() {
      runOnUiThread {
        val p = localNetworkPermission()
        if (p == null || hasLocalNetwork()) tellPage(true) else localNetworkRequest.launch(p)
      }
    }
  }
}
