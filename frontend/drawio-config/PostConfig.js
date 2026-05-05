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
 * Gated on lightbox=1 / chromeless=1 so the editor route (embed=1) is
 * unaffected; that route has its own click handling via Draw.loadPlugin
 * in DiagramEditor.tsx.
 */
(function () {
  // Read URL params defensively — urlParams is a DrawIO global set during
  // mxClient init, but if it isn't yet defined for some reason, parse
  // window.location.search ourselves.
  function param(name) {
    try {
      if (typeof urlParams !== "undefined" && urlParams[name] != null) {
        return urlParams[name];
      }
    } catch (e) {
      /* ignore */
    }
    var match = new RegExp("[?&]" + name + "=([^&]*)").exec(
      window.location.search,
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  var isViewer = param("lightbox") === "1" || param("chromeless") === "1";
  // eslint-disable-next-line no-console
  console.log(
    "[turbo-ea PostConfig] loaded; lightbox=" +
      param("lightbox") +
      " chromeless=" +
      param("chromeless") +
      " isViewer=" +
      isViewer +
      " Graph=" +
      typeof Graph,
  );
  if (!isViewer || typeof Graph === "undefined" || !Graph.prototype) {
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
      // eslint-disable-next-line no-console
      console.log("[turbo-ea PostConfig] Graph instance initialised; wrapping click + cursor");

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
