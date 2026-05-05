/**
 * DrawIO PreConfig.js — loaded BEFORE app.min.js (per DrawIO index.html).
 *
 * Why we hook here instead of PostConfig.js:
 *
 * DrawIO loads scripts in this order:
 *
 *   1. PreConfig.js          ← we are here
 *   2. mxClient.js
 *   3. app.min.js            ← defines Graph, EditorUi, App, ...
 *   4. checkAllLoaded()      ← calls App.main(), which constructs the graph
 *   5. PostConfig.js         ← loads AFTER the graph is already built
 *
 * The Turbo EA viewer needs to wrap each Graph instance's click method to
 * forward cardId clicks to the parent window. In chromeless / lightbox
 * mode, DrawIO replaces graph.click on the *instance* itself (shadowing
 * any prototype patch applied later), and App.main keeps the EditorUi
 * inside a closure (so we can't find the instance from outside).
 *
 * Solution: trap the assignment of `window.Graph` via Object.defineProperty.
 * The setter fires the moment app.min.js executes `Graph = function ...`,
 * which is before App.main runs. We patch Graph.prototype.init to wrap
 * each instance's click + cursor, so the wrapper is applied AFTER any
 * chromeless override is installed (those happen during instance init).
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
  var isViewer = param("lightbox") === "1" || param("chromeless") === "1";
  // eslint-disable-next-line no-console
  console.log(
    "[turbo-ea PreConfig] loaded; lightbox=" +
      param("lightbox") +
      " chromeless=" +
      param("chromeless") +
      " isViewer=" +
      isViewer,
  );
  if (!isViewer) return;

  function readCardId(cell) {
    try {
      return cell && cell.value && cell.value.getAttribute
        ? cell.value.getAttribute("cardId")
        : null;
    } catch (e) {
      return null;
    }
  }

  function patchGraphClass(GraphClass) {
    if (
      !GraphClass ||
      !GraphClass.prototype ||
      GraphClass.prototype.__turboEaPatched
    ) {
      return;
    }
    GraphClass.prototype.__turboEaPatched = true;

    function makeWrapper(orig) {
      return function () {
        var result;
        try {
          result = orig ? orig.apply(this, arguments) : undefined;
        } catch (e) {
          /* original init failure — surface it but keep going */
          // eslint-disable-next-line no-console
          console.warn("[turbo-ea PreConfig] orig init threw:", e);
        }
        try {
          var graph = this;
          // eslint-disable-next-line no-console
          console.log(
            "[turbo-ea PreConfig] Graph instance initialised; wrapping click + cursor",
          );

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
            if (origClick) return origClick.apply(this, arguments);
          };

          var origCursor = graph.getCursorForCell;
          graph.getCursorForCell = function (cell) {
            if (readCardId(cell)) return "pointer";
            if (origCursor) return origCursor.apply(this, arguments);
            return "default";
          };
        } catch (e) {
          /* swallow — best effort */
        }
        return result;
      };
    }

    // Wrap any init that's already there (in case app.min.js assigned it
    // before our setter fired).
    var _initFn;
    if (typeof GraphClass.prototype.init === "function") {
      _initFn = makeWrapper(GraphClass.prototype.init);
    }

    // Trap *every* future assignment to Graph.prototype.init. app.min.js
    // assigns init AFTER it assigns the class itself, so a one-shot wrap
    // would be clobbered. With this accessor, the wrapping rides every
    // assignment, and instance lookups (`this.init(container)` inside the
    // mxGraph constructor) read the wrapped version.
    try {
      Object.defineProperty(GraphClass.prototype, "init", {
        configurable: true,
        set: function (value) {
          _initFn = makeWrapper(value);
        },
        get: function () {
          return _initFn;
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        "[turbo-ea PreConfig] could not defineProperty(Graph.prototype.init):",
        e,
      );
    }
  }

  // Trap the Graph class assignment. app.min.js assigns to window.Graph,
  // and our setter fires immediately so we patch before any instance.
  var _Graph;
  try {
    Object.defineProperty(window, "Graph", {
      configurable: true,
      set: function (value) {
        _Graph = value;
        // eslint-disable-next-line no-console
        console.log(
          "[turbo-ea PreConfig] Graph class defined; patching prototype",
        );
        patchGraphClass(value);
      },
      get: function () {
        return _Graph;
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[turbo-ea PreConfig] could not defineProperty(Graph):", e);
  }
})();
