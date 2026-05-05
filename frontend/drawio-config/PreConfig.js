/**
 * DrawIO PreConfig.js — loaded BEFORE app.min.js (per DrawIO index.html).
 *
 * Why we hook here instead of PostConfig.js:
 *
 * DrawIO loads scripts in this order:
 *
 *   1. PreConfig.js          ← we are here
 *   2. mxClient.js           (defines mxGraph)
 *   3. app.min.js            (defines Graph, EditorUi, App, ...)
 *   4. checkAllLoaded()      (calls App.main(), which constructs the graph)
 *   5. PostConfig.js         (loads AFTER the graph is already built)
 *
 * The Turbo EA viewer needs to wrap each Graph instance's click method to
 * forward cardId clicks to the parent window. In chromeless / lightbox
 * mode, DrawIO replaces graph.click on the *instance* itself (shadowing
 * any prototype patch applied later), and App.main keeps the EditorUi
 * inside a closure (so we can't find the instance from outside).
 *
 * Strategy: trap the assignment of `window.Graph` / `window.mxGraph` via
 * Object.defineProperty. When either class is assigned by app.min.js, we
 * convert `Class.prototype.click` and `Class.prototype.getCursorForCell`
 * into accessor properties whose setters re-wrap each subsequent value.
 * This survives both the late prototype assignment app.min.js does after
 * declaring the class AND any chromeless-mode override that re-assigns
 * the prototype method.
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

  // Build the click wrapper. `orig` may be undefined if the prototype
  // method hasn't been assigned yet — the wrapper falls through cleanly.
  function makeClickWrapper(orig) {
    return function (me) {
      try {
        var cell = me && me.getCell && me.getCell();
        while (cell && !readCardId(cell)) cell = cell.parent;
        var cardId = readCardId(cell);
        if (cardId) {
          // eslint-disable-next-line no-console
          console.log("[turbo-ea PreConfig] cardClicked", cardId);
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

  // Convert a prototype method into an accessor that re-wraps every
  // future assignment. Returns true if installed.
  function installAccessor(proto, name, makeWrapper, label) {
    if (!proto || proto["__turboEaTrapped_" + name]) return false;
    proto["__turboEaTrapped_" + name] = true;

    var current;
    if (typeof proto[name] === "function") {
      current = makeWrapper(proto[name]);
    }

    try {
      Object.defineProperty(proto, name, {
        configurable: true,
        set: function (value) {
          // eslint-disable-next-line no-console
          console.log(
            "[turbo-ea PreConfig] " + label + " (re)assigned; wrapping",
          );
          current = makeWrapper(value);
        },
        get: function () {
          return current;
        },
      });
      // eslint-disable-next-line no-console
      console.log("[turbo-ea PreConfig] accessor installed for " + label);
      return true;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        "[turbo-ea PreConfig] could not defineProperty(" + label + "):",
        e,
      );
      return false;
    }
  }

  function patchClass(ClassRef, classLabel) {
    if (!ClassRef || !ClassRef.prototype) return;
    installAccessor(
      ClassRef.prototype,
      "click",
      makeClickWrapper,
      classLabel + ".prototype.click",
    );
    installAccessor(
      ClassRef.prototype,
      "getCursorForCell",
      makeCursorWrapper,
      classLabel + ".prototype.getCursorForCell",
    );
  }

  // Trap class assignments so we can install accessors the moment each
  // class is defined by app.min.js / mxClient.js.
  function trapClass(globalName) {
    var _Class;
    try {
      Object.defineProperty(window, globalName, {
        configurable: true,
        set: function (value) {
          _Class = value;
          // eslint-disable-next-line no-console
          console.log(
            "[turbo-ea PreConfig] " + globalName + " class defined; patching",
          );
          patchClass(value, globalName);
        },
        get: function () {
          return _Class;
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        "[turbo-ea PreConfig] could not defineProperty(" + globalName + "):",
        e,
      );
    }
  }

  // Patch both classes — the lightbox might construct via either, and
  // mxGraph defines the methods that Graph (DrawIO's subclass) overrides
  // and re-overrides during chromeless setup.
  trapClass("mxGraph");
  trapClass("Graph");
})();
