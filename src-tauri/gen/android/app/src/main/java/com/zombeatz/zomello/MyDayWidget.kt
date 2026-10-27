package com.zombeatz.zomello

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.io.File
import java.time.LocalDate

/**
 * The My Day home-screen widget. Zomello's page writes today's and tomorrow's My Day to a small file
 * (MainActivity.updateWidget, see src/widget.ts); this shows the one for today. Tapping it opens My Day.
 */
class MyDayWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, render(context))
  }

  companion object {
    private const val FILE = "widget.json"
    private val ROWS = intArrayOf(R.id.row0, R.id.row1, R.id.row2, R.id.row3, R.id.row4, R.id.row5)

    /** Save what the page sent and redraw every My Day widget. */
    fun save(context: Context, json: String) {
      File(context.filesDir, FILE).writeText(json)
      refresh(context)
    }

    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, MyDayWidget::class.java))
      if (ids.isEmpty()) return
      val views = render(context)
      for (id in ids) manager.updateAppWidget(id, views)
    }

    private fun render(context: Context): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_my_day)
      val open = Intent(context, MainActivity::class.java).apply {
        action = Intent.ACTION_MAIN
        putExtra("zomelloOpen", "myday")
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      }
      views.setOnClickPendingIntent(
        R.id.widget_root,
        PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
      )

      val data = try {
        JSONObject(File(context.filesDir, FILE).readText())
      } catch (e: Exception) {
        null
      }
      val today = data?.optJSONObject("days")?.optJSONArray(LocalDate.now().toString())
      for (row in ROWS) views.setViewVisibility(row, View.GONE)
      views.setViewVisibility(R.id.more, View.GONE)
      if (today == null) {
        views.setTextViewText(R.id.empty, context.getString(if (data == null) R.string.widget_empty else R.string.widget_stale))
        views.setViewVisibility(R.id.empty, View.VISIBLE)
        return views
      }
      views.setViewVisibility(R.id.empty, if (today.length() == 0) View.VISIBLE else View.GONE)
      views.setTextViewText(R.id.empty, context.getString(R.string.widget_empty))
      for (i in 0 until minOf(today.length(), ROWS.size)) {
        val item = today.getJSONObject(i)
        val line = SpannableStringBuilder()
        val whenText = item.optString("when")
        if (whenText.isNotEmpty()) {
          val start = line.length
          line.append(whenText).append("  ")
          val color = if (item.optBoolean("late")) Color.parseColor("#FFF87171") else Color.parseColor("#FF4FB0EC")
          line.setSpan(ForegroundColorSpan(color), start, line.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        line.append(item.optString("title"))
        val board = item.optString("board")
        if (board.isNotEmpty()) {
          val start = line.length
          line.append("  ·  ").append(board)
          line.setSpan(ForegroundColorSpan(Color.parseColor("#FF8A93A6")), start, line.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        views.setTextViewText(ROWS[i], line)
        views.setViewVisibility(ROWS[i], View.VISIBLE)
      }
      if (today.length() > ROWS.size) {
        views.setTextViewText(R.id.more, "+${today.length() - ROWS.size} more")
        views.setViewVisibility(R.id.more, View.VISIBLE)
      }
      return views
    }
  }
}
