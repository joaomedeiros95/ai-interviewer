/**
 * video.js — "video call" UX layer for the interview room.
 *
 * Purely presentational: the interview stays voice-driven (interview.js +
 * speech.js own the mic and the flow). This file only
 *   1. animates a "speaking" indicator on the AI interviewer tile while
 *      speechSynthesis is reading a question (polled — no changes to
 *      interview.js), and
 *   2. manages an OPTIONAL camera self-view via getUserMedia({video: true,
 *      audio: false}). audio stays false: mic audio belongs to speech
 *      recognition. Camera failure must NEVER block the interview.
 */
(function () {
  'use strict';

  var strip = document.getElementById('call-strip');
  if (!strip) {
    return;
  }

  var els = {
    interviewerTile: document.getElementById('tile-interviewer'),
    candidateTile: document.getElementById('tile-candidate'),
    video: document.getElementById('self-video'),
    placeholder: document.getElementById('camera-placeholder'),
    cameraStatus: document.getElementById('camera-status'),
    cameraBtn: document.getElementById('camera-btn')
  };

  /* ---------------- interviewer "speaking" indicator ----------------
   * interview.js drives speechSynthesis; we only observe it. Poll every
   * 250ms and toggle a CSS class — cheap, and utterances have no reliable
   * cross-browser end events anyway. */

  if (els.interviewerTile && 'speechSynthesis' in window) {
    window.setInterval(function () {
      var speaking = false;
      try {
        speaking = window.speechSynthesis.speaking;
      } catch (e) {
        // some browsers throw on detached/odd states — treat as not speaking
      }
      els.interviewerTile.classList.toggle('is-speaking', !!speaking);
    }, 250);
  }

  /* ---------------- optional camera self-view ---------------- */

  var stream = null; // active MediaStream, or null when camera is off
  var starting = false;

  function setCameraStatus(message, isError) {
    if (els.cameraStatus) {
      els.cameraStatus.textContent = message;
      els.cameraStatus.classList.toggle('is-error', !!isError);
    }
  }

  function setButton(cameraOn) {
    if (!els.cameraBtn) {
      return;
    }
    els.cameraBtn.textContent = cameraOn ? '📷 Camera off' : '📷 Camera on';
    els.cameraBtn.setAttribute('aria-pressed', cameraOn ? 'true' : 'false');
  }

  function stopCamera(statusMessage) {
    if (stream) {
      try {
        stream.getTracks().forEach(function (track) {
          track.stop();
        });
      } catch (e) {
        // best effort — never let cleanup break the room
      }
      stream = null;
    }
    if (els.video) {
      try {
        els.video.srcObject = null;
      } catch (e) { /* ignore */ }
      els.video.hidden = true;
    }
    if (els.placeholder) {
      els.placeholder.hidden = false;
    }
    if (els.candidateTile) {
      els.candidateTile.classList.remove('camera-on');
    }
    setButton(false);
    setCameraStatus(statusMessage || 'Camera off', false);
  }

  function cameraUnavailable() {
    stopCamera();
    setCameraStatus('Camera unavailable — interview continues voice-only', true);
  }

  function attachStream(mediaStream) {
    stream = mediaStream;
    els.video.srcObject = mediaStream;
    els.video.muted = true; // belt & braces alongside the muted attribute
    els.video.hidden = false;
    if (els.placeholder) {
      els.placeholder.hidden = true;
    }
    if (els.candidateTile) {
      els.candidateTile.classList.add('camera-on');
    }
    setButton(true);
    setCameraStatus('');

    // If the track dies outside our control (permission revoked, device
    // unplugged), fall back to the placeholder instead of a frozen frame.
    mediaStream.getVideoTracks().forEach(function (track) {
      track.onended = function () {
        if (stream === mediaStream) {
          stopCamera();
        }
      };
    });

    var playPromise = els.video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(function () {
        // Autoplay of a muted local stream shouldn't be blocked; if it is,
        // the placeholder path still leaves the interview fully usable.
      });
    }
  }

  function startCamera() {
    if (starting || stream || !els.video) {
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraUnavailable();
      return;
    }
    starting = true;
    if (els.cameraBtn) {
      els.cameraBtn.disabled = true;
    }
    setCameraStatus('Starting camera…', false);

    // audio: false is deliberate — the mic is owned by speech recognition.
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then(function (mediaStream) {
        starting = false;
        if (els.cameraBtn) {
          els.cameraBtn.disabled = false;
        }
        attachStream(mediaStream);
      })
      .catch(function () {
        starting = false;
        if (els.cameraBtn) {
          els.cameraBtn.disabled = false;
        }
        cameraUnavailable(); // denied/missing camera — voice flow unaffected
      });
  }

  if (els.cameraBtn) {
    els.cameraBtn.addEventListener('click', function () {
      if (stream) {
        stopCamera();
      } else {
        startCamera();
      }
    });
  }

  // Release the camera when leaving the page (pagehide covers bfcache-y
  // navigations; beforeunload covers the rest).
  function releaseOnLeave() {
    if (stream) {
      stopCamera();
    }
  }
  window.addEventListener('pagehide', releaseOnLeave);
  window.addEventListener('beforeunload', releaseOnLeave);
})();
