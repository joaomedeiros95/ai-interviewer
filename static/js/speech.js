/**
 * speech.js — thin wrapper around the Web Speech API (SpeechRecognition).
 *
 * Usage:
 *   var rec = Speech.createRecognizer({ onInterim, onFinal, onError, onEnd });
 *   rec.start(); rec.stop();
 *
 * - continuous + interimResults + lang 'en-US'
 * - Final transcript chunks are delivered through onFinal(text), one chunk per
 *   finalized result; the caller accumulates them.
 * - Chrome's recognizer likes to auto-stop after silence: if it ends while the
 *   user still wants to listen, we restart it (capped, so a broken mic can't
 *   cause an infinite restart loop).
 * - onEnd(unexpected) fires when listening truly stops; `unexpected` is true
 *   when the user did NOT ask for the stop (permission error, restart cap...).
 */
(function (global) {
  'use strict';

  var SR = global.SpeechRecognition || global.webkitSpeechRecognition || null;

  var FATAL_ERRORS = ['not-allowed', 'service-not-allowed', 'network', 'audio-capture'];
  var MAX_AUTO_RESTARTS = 8;

  function noop() {}

  function createRecognizer(opts) {
    opts = opts || {};
    var onInterim = opts.onInterim || noop;
    var onFinal = opts.onFinal || noop;
    var onError = opts.onError || noop;
    var onEnd = opts.onEnd || noop;

    if (!SR) {
      return {
        supported: false,
        listening: false,
        start: noop,
        stop: noop
      };
    }

    var recognition = null;
    var wantListening = false; // the user's intent, not the engine state
    var autoRestarts = 0;
    var fatal = false;

    var api = {
      supported: true,
      listening: false,
      start: start,
      stop: stop
    };

    function build() {
      recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = function (event) {
        var interim = '';
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var result = event.results[i];
          var text = result[0] ? result[0].transcript : '';
          if (result.isFinal) {
            autoRestarts = 0; // real progress: reset the restart budget
            if (text.trim()) {
              onFinal(text.trim());
            }
          } else {
            interim += text;
          }
        }
        onInterim(interim);
      };

      recognition.onerror = function (event) {
        var code = (event && event.error) || 'unknown';
        if (FATAL_ERRORS.indexOf(code) !== -1) {
          fatal = true;
          wantListening = false;
        }
        // 'no-speech' and 'aborted' are non-fatal; onend decides what happens.
        onError(code);
      };

      recognition.onend = function () {
        if (wantListening && !fatal && autoRestarts < MAX_AUTO_RESTARTS) {
          // The engine auto-stopped (silence timeout etc.) but the user never
          // clicked stop — restart to keep the click-to-stop UX honest.
          autoRestarts += 1;
          try {
            recognition.start();
            return;
          } catch (e) {
            // fall through to a real end
          }
        }
        var unexpected = wantListening;
        wantListening = false;
        api.listening = false;
        onEnd(unexpected);
      };
    }

    function start() {
      if (api.listening) {
        return;
      }
      fatal = false;
      autoRestarts = 0;
      wantListening = true;
      build(); // fresh instance every session avoids stale-engine weirdness
      try {
        recognition.start();
        api.listening = true;
      } catch (e) {
        wantListening = false;
        api.listening = false;
        onError('start-failed');
        onEnd(true);
      }
    }

    function stop() {
      wantListening = false;
      api.listening = false;
      if (recognition) {
        try {
          recognition.stop();
        } catch (e) {
          // already stopped — fine
        }
      }
    }

    return api;
  }

  global.Speech = {
    supported: !!SR,
    createRecognizer: createRecognizer
  };
})(window);
