/**
 * DrawIO PostConfig.js — loaded AFTER app.min.js but BEFORE App.main.
 *
 * The Turbo EA diagram viewer (lightbox mode) needs to know when a user
 * clicks a cell that represents a card so it can pop the side panel in
 * the parent window. Two complications:
 *
 *  1. App.main creates the EditorUi inside a closure and never publishes
 *     the instance globally — so the parent can't reach editor.graph by
 *     property lookup on iframe.contentWindow.
 *  2. In chromeless / lightbox mode DrawIO replaces graph.click on the
 *     instance, which shadows any patch we'd apply to Graph.prototype
 *     from outside. Patching after the fact requires finding the
 *     instance, which we can't do (see #1).
 *
 * Solution: patch Graph.prototype.init from inside the iframe (no
 * cross-frame timing race). The wrapper runs once per Graph instance and
 * wraps that instance's click + getCursorForCell methods directly, AFTER
 * any chromeless overrides have been installed. cardId clicks are
 * forwarded to the parent via postMessage — same-origin so simple JSON
 * payloads work.
 *
 * Gated on lightbox=1 so the editor route (embed=1) is unaffected; that
 * route has its own click handling via Draw.loadPlugin in DiagramEditor.
 */
(function () {
  if (
    typeof urlParams === "undefined" ||
    urlParams["lightbox"] !== "1" ||
    typeof Graph === "undefined" ||
    !Graph.prototype
  ) {
    return;
  }

  function readCardId(cell) {
    try {
      return cell && cell.value && cell.value.getAttribute
        ? cell.value.getAttribute("cardId")
        : null;
    } catch (e) {
      return null;
    }
  }

  var origInit = Graph.prototype.init;
  Graph.prototype.init = function (container) {
    var result = origInit.apply(this, arguments);
    try {
      var graph = this;

      var origClick = graph.click;
      graph.click = function (me) {
        try {
          var cell = me && me.getCell && me.getCell();
          while (cell && !readCardId(cell)) cell = cell.parent;
          var cardId = readCardId(cell);
          if (cardId) {
            window.parent.postMessage(
              JSON.stringify({ event: "cardClicked", cardId: cardId }),
              "*",
            );
            // Don't follow chromeless's default click — it would try to
            // open a hyperlink on the cell.
            return;
          }
        } catch (e) {
          /* fall through */
        }
        return origClick.apply(this, arguments);
      };

      var origCursor = graph.getCursorForCell;
      graph.getCursorForCell = function (cell) {
        if (readCardId(cell)) return "pointer";
        return origCursor.apply(this, arguments);
      };
    } catch (e) {
      /* swallow — patching is best-effort */
    }
    return result;
  };
})();
