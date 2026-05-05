/**
 * DrawIO PreConfig.js — loaded BEFORE app.min.js (per DrawIO index.html).
 *
 * Hooks the read-only diagram viewer (lightbox / chromeless mode) so that
 * clicking a cell with a `cardId` attribute posts a `cardClicked` message
 * to the parent window, which opens the Turbo EA card details side panel.
 *
 * Why we hook here instead of from the parent or PostConfig.js:
 *
 *   1. App.main creates the EditorUi inside a closure and never publishes
 *      the instance globally — so the parent can't reach editor.graph by
 *      property lookup on iframe.contentWindow.
 *   2. In chromeless mode DrawIO replaces graph.click on the *instance*,
 *      shadowing any prototype patch applied later from outside.
 *   3. PostConfig.js loads AFTER App.main has constructed the graph, so
 *      patching there is too late.
 *   4. app.min.js may replace `Graph.prototype` entirely after declaring
 *      the class, discarding any one-shot patches.
 *
 * Strategy: trap the assignment of `window.Graph` via Object.defineProperty,
 * then convert `Graph.prototype.click` and `Graph.prototype.getCursorForCell`
 * into accessor properties whose setters re-wrap each subsequent value.
 * Plus a poller that re-installs the accessors if Graph.prototype itself
 * is reassigned (which app.min.js does as part of subclass setup).
 *
 * Gated on lightbox=1 / chromeless=1 so the editor route (embed=1) is
 * unaffected — that route uses Draw.loadPlugin from DiagramEditor.tsx.
 */
(function () {
  function param(name) {
    var match = new RegExp("[?&]" + name + "=([^&]*)").exec(
      window.location.search,
    );
    return match ? decodeURIComponent(match[1]) : null;
  }
  if (param("lightbox") !== "1" && param("chromeless") !== "1") return;

  function readCardId(cell) {
    try {
      return cell && cell.value && cell.value.getAttribute
        ? cell.value.getAttribute("cardId")
        : null;
    } catch (e) {
      return null;
    }
  }

  function makeClickWrapper(orig) {
    return function (me) {
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
      if (orig) return orig.apply(this, arguments);
    };
  }

  function makeCursorWrapper(orig) {
    return function (cell) {
      if (readCardId(cell)) return "pointer";
      if (orig) return orig.apply(this, arguments);
      return "default";
    };
  }

  function installAccessor(proto, name, makeWrapper) {
    if (!proto || proto["__turboEaTrapped_" + name]) return;
    proto["__turboEaTrapped_" + name] = true;
    var current;
    if (typeof proto[name] === "function") {
      current = makeWrapper(proto[name]);
    }
    try {
      Object.defineProperty(proto, name, {
        configurable: true,
        set: function (value) {
          current = makeWrapper(value);
        },
        get: function () {
          return current;
        },
      });
    } catch (e) {
      /* defineProperty refused — best effort */
    }
  }

  function patchClass(ClassRef) {
    if (!ClassRef || !ClassRef.prototype) return;
    installAccessor(ClassRef.prototype, "click", makeClickWrapper);
    installAccessor(ClassRef.prototype, "getCursorForCell", makeCursorWrapper);
  }

  function trapClass(globalName) {
    var _Class;
    try {
      Object.defineProperty(window, globalName, {
        configurable: true,
        set: function (value) {
          _Class = value;
          patchClass(value);
        },
        get: function () {
          return _Class;
        },
      });
    } catch (e) {
      /* refused — best effort */
    }
  }

  trapClass("mxGraph");
  trapClass("Graph");

  // app.min.js can replace Graph.prototype entirely (Graph.prototype =
  // Object.create(mxGraph.prototype)), discarding our accessor traps with
  // the old prototype object. Detect identity changes and re-install.
  // Polling stops once Graph is rendered and stable (30 s).
  var lastProto = null;
  var poll = setInterval(function () {
    try {
      var GraphRef = window.Graph;
      if (!GraphRef || !GraphRef.prototype) return;
      if (GraphRef.prototype !== lastProto) {
        lastProto = GraphRef.prototype;
        if (!GraphRef.prototype.__turboEaTrapped_click) {
          patchClass(GraphRef);
        }
      }
    } catch (e) {
      /* ignore */
    }
  }, 50);
  setTimeout(function () {
    clearInterval(poll);
  }, 30000);
})();
