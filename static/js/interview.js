/**
 * interview.js — interview room controller.
 *
 * Loads session state (GET /api/sessions/<id>/), renders the transcript and
 * the current question, and keeps the decision panel live. Answers are
 * VOICE-ONLY: speech is transcribed into a read-only display and submitted
 * (POST /api/sessions/<id>/answers/) on "Stop & submit". Without a working
 * mic + Chrome/Edge, the interview cannot proceed and says so explicitly.
 */
(function () {
  'use strict';

  var root = document.getElementById('room');
  if (!root) {
    return;
  }

  var sessionId = root.dataset.sessionId;
  var SESSION_URL = '/api/sessions/' + sessionId + '/';
  var ANSWERS_URL = '/api/sessions/' + sessionId + '/answers/';
  var RESULTS_URL = '/results/' + sessionId + '/';
  var TOTAL_QUESTIONS = 7;

  var csrfMeta = document.querySelector('meta[name="csrf-token"]');
  var csrfToken = csrfMeta ? csrfMeta.content : '';

  var els = {
    qNumber: document.getElementById('q-number'),
    roomStatus: document.getElementById('room-status'),
    progressFill: document.getElementById('progress-fill'),
    errorBanner: document.getElementById('error-banner'),
    transcript: document.getElementById('transcript'),
    questionText: document.getElementById('question-text'),
    followupBadge: document.getElementById('q-followup-badge'),
    ttsToggle: document.getElementById('tts-toggle'),
    replayBtn: document.getElementById('replay-btn'),
    micBtn: document.getElementById('mic-btn'),
    speechStatus: document.getElementById('speech-status'),
    interim: document.getElementById('interim-text'),
    answerText: document.getElementById('answer-text'),
    sendBtn: document.getElementById('send-btn'),
    clearBtn: document.getElementById('clear-btn'),
    thinking: document.getElementById('thinking'),
    dpSignals: document.getElementById('dp-signals'),
    dpSignalsEmpty: document.getElementById('dp-signals-empty'),
    dpGaps: document.getElementById('dp-gaps'),
    dpGapsEmpty: document.getElementById('dp-gaps-empty'),
    dpTopics: document.getElementById('dp-topics'),
    dpFollowups: document.getElementById('dp-followups'),
    dpRationale: document.getElementById('dp-rationale')
  };

  var state = {
    questionNumber: 0, // 1-based number of the question on screen
    currentQuestion: null, // {index, text, meta}
    submitting: false,
    listening: false,
    voiceBlocked: false,
    submitAfterStop: false,
    submitAfterStopTimer: null,
    ttsUnlocked: false // true once speechSynthesis has actually produced audio
  };

  /* ---------------- generic helpers ---------------- */

  function showError(message) {
    els.errorBanner.textContent = message;
    els.errorBanner.hidden = false;
  }

  function clearError() {
    els.errorBanner.hidden = true;
    els.errorBanner.textContent = '';
  }

  function parseErrorResponse(res) {
    return res.json().then(
      function (body) {
        return (body && body.error) || 'HTTP ' + res.status;
      },
      function () {
        return 'HTTP ' + res.status;
      }
    );
  }

  function getAnswer() {
    return els.answerText.textContent.trim();
  }

  function setAnswer(text) {
    els.answerText.textContent = text;
    els.answerText.scrollTop = els.answerText.scrollHeight;
  }

  function setControlsDisabled(disabled) {
    if (state.voiceBlocked) {
      els.micBtn.disabled = true;
      els.sendBtn.disabled = true;
      els.clearBtn.disabled = true;
      return;
    }
    els.micBtn.disabled = disabled;
    els.sendBtn.disabled = disabled;
    els.clearBtn.disabled = disabled;
  }

  // Voice is the only input path: without it the interview cannot proceed.
  function blockVoiceOnly(reason) {
    state.voiceBlocked = true;
    setControlsDisabled(true);
    setSpeechStatus('', false);
    showError(
      'This interview is voice-only. ' + reason + ' ' +
      'Please open this page in Chrome or Edge on desktop, allow microphone ' +
      'access, and refresh.'
    );
  }

  function showThinking(on) {
    els.thinking.hidden = !on;
  }

  function setSpeechStatus(message, isError) {
    els.speechStatus.textContent = message || '';
    els.speechStatus.classList.toggle('is-error', !!isError);
  }

  /* ---------------- text-to-speech ---------------- */

  function speakQuestion(text, force) {
    if (!('speechSynthesis' in window)) {
      return;
    }
    try {
      window.speechSynthesis.cancel(); // never overlap questions
      if ((!els.ttsToggle.checked && !force) || !text) {
        return;
      }
      var utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.onstart = function () {
        state.ttsUnlocked = true;
      };
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      // TTS is best-effort only
    }
  }

  els.ttsToggle.addEventListener('change', function () {
    if (!els.ttsToggle.checked && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  });

  els.replayBtn.addEventListener('click', function () {
    if (state.currentQuestion) {
      speakQuestion(state.currentQuestion.text, true); // explicit ask overrides the toggle
    }
  });

  // Chrome drops speechSynthesis.speak() issued before the user interacts with
  // the page, so the on-load attempt for question 1 can be silently blocked.
  // The first gesture inside the room retries it — except on the mic button,
  // where speaking over the candidate's recording would be worse than silence.
  document.addEventListener('pointerdown', function (event) {
    if (state.ttsUnlocked || state.listening || state.submitting) {
      return;
    }
    if (event.target.closest && event.target.closest('#mic-btn')) {
      return;
    }
    if (els.ttsToggle.checked && state.currentQuestion) {
      speakQuestion(state.currentQuestion.text);
    }
  });

  /* ---------------- transcript + question rendering ---------------- */

  function addTurn(role, text, meta) {
    var turn = document.createElement('div');
    turn.className =
      'turn ' + (role === 'interviewer' ? 'turn-interviewer' : 'turn-candidate');

    var roleEl = document.createElement('div');
    roleEl.className = 'turn-role';
    roleEl.textContent = role === 'interviewer' ? 'Interviewer' : 'You';
    if (role === 'interviewer' && meta && meta.kind === 'followup') {
      roleEl.appendChild(document.createTextNode(' '));
      var badge = document.createElement('span');
      badge.className = 'badge-followup';
      badge.textContent = 'follow-up';
      roleEl.appendChild(badge);
    }

    var textEl = document.createElement('div');
    textEl.className = 'turn-text';
    textEl.textContent = text;

    turn.appendChild(roleEl);
    turn.appendChild(textEl);
    els.transcript.appendChild(turn);
    els.transcript.scrollTop = els.transcript.scrollHeight;
  }

  function updateProgress() {
    var n = Math.min(state.questionNumber, TOTAL_QUESTIONS);
    els.qNumber.textContent = n > 0 ? String(n) : '–';
    var pct = (Math.max(n, 0) / TOTAL_QUESTIONS) * 100;
    els.progressFill.style.width = pct + '%';
  }

  function setQuestion(question) {
    state.currentQuestion = question;
    state.questionNumber = Math.min(state.questionNumber + 1, TOTAL_QUESTIONS);
    els.questionText.textContent = question.text;
    var meta = question.meta || {};
    els.followupBadge.hidden = meta.kind !== 'followup';
    if (meta.rationale) {
      els.dpRationale.textContent = meta.rationale;
    }
    updateProgress();
  }

  /* ---------------- decision panel ---------------- */

  function renderPairList(listEl, emptyEl, items, renderItem) {
    listEl.textContent = '';
    var shown = 0;
    (items || []).forEach(function (item) {
      var li = renderItem(item);
      if (li) {
        listEl.appendChild(li);
        shown += 1;
      }
    });
    emptyEl.hidden = shown > 0;
  }

  function renderTopics(coveredIds) {
    var covered = {};
    (coveredIds || []).forEach(function (id) {
      covered[String(id)] = true;
    });
    els.dpTopics.textContent = '';
    var ids = [1, 2, 3, 4, 5];
    (coveredIds || []).forEach(function (id) {
      if (ids.indexOf(id) === -1) {
        ids.push(id); // defensive: packs might use other ids
      }
    });
    ids.forEach(function (id) {
      var chip = document.createElement('span');
      chip.className = 'chip' + (covered[String(id)] ? ' covered' : '');
      chip.textContent = 'topic ' + id;
      els.dpTopics.appendChild(chip);
    });
  }

  function updateDecisionPanel(panel) {
    if (!panel || typeof panel !== 'object') {
      return;
    }
    renderPairList(els.dpSignals, els.dpSignalsEmpty, panel.signals, function (sig) {
      if (!sig) {
        return null;
      }
      var li = document.createElement('li');
      var skill = document.createElement('span');
      skill.className = 'dp-skill';
      skill.textContent = sig.skill || 'unknown skill';
      li.appendChild(skill);
      if (sig.evidence) {
        var ev = document.createElement('span');
        ev.className = 'dp-evidence';
        ev.textContent = sig.evidence;
        li.appendChild(ev);
      }
      return li;
    });

    renderPairList(els.dpGaps, els.dpGapsEmpty, panel.gaps, function (gap) {
      if (!gap) {
        return null;
      }
      var li = document.createElement('li');
      li.textContent = gap;
      return li;
    });

    renderTopics(panel.covered_topics);

    if (typeof panel.followups_used === 'number') {
      els.dpFollowups.textContent = String(panel.followups_used);
    }
    if (panel.rationale) {
      els.dpRationale.textContent = panel.rationale;
    }
  }

  // On page load/refresh we only have turns (GET session doesn't include the
  // decision panel), so rebuild what we can from interviewer turn metadata.
  function derivePanelFromTurns(interviewerTurns) {
    var covered = [];
    var followups = 0;
    interviewerTurns.forEach(function (turn) {
      var meta = turn.meta || {};
      if (meta.kind === 'followup') {
        followups += 1;
      }
      if (meta.topic_id !== undefined && covered.indexOf(meta.topic_id) === -1) {
        covered.push(meta.topic_id);
      }
    });
    renderTopics(covered);
    els.dpFollowups.textContent = String(followups);
  }

  /* ---------------- submit path (voice and typed both land here) ------- */

  function submitAnswer() {
    if (state.submitting) {
      return;
    }
    var text = getAnswer();
    if (!text) {
      setSpeechStatus('Nothing captured yet — click the mic and speak your answer.', false);
      return;
    }

    stopListening(false);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    state.submitting = true;
    clearError();
    setControlsDisabled(true);
    showThinking(true);
    els.roomStatus.textContent = 'Waiting for the interviewer…';

    fetch(ANSWERS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken
      },
      body: JSON.stringify({ text: text })
    })
      .then(function (res) {
        if (res.status === 409) {
          // session already completed — results are the right place to be
          window.location.href = RESULTS_URL;
          return null;
        }
        if (!res.ok) {
          return parseErrorResponse(res).then(function (message) {
            throw new Error(message);
          });
        }
        return res.json();
      })
      .then(function (data) {
        if (!data) {
          return; // redirecting
        }
        // The answer is recorded: archive the asked question + the answer.
        if (state.currentQuestion) {
          addTurn('interviewer', state.currentQuestion.text, state.currentQuestion.meta);
        }
        addTurn('candidate', text, {});
        setAnswer('');
        els.interim.textContent = '';
        setSpeechStatus('');

        updateDecisionPanel(data.decision_panel);

        if (data.done) {
          state.currentQuestion = null;
          els.followupBadge.hidden = true;
          els.questionText.textContent =
            'That was the last question — preparing your results…';
          els.roomStatus.textContent = 'Interview complete';
          els.progressFill.style.width = '100%';
          window.setTimeout(function () {
            window.location.href = RESULTS_URL;
          }, 1200);
          return;
        }

        if (data.question && data.question.text) {
          setQuestion(data.question);
          speakQuestion(data.question.text);
          state.submitting = false;
          setControlsDisabled(false);
          showThinking(false);
          els.roomStatus.textContent = 'In progress';
        } else {
          throw new Error('Server returned no next question.');
        }
      })
      .catch(function (err) {
        state.submitting = false;
        setControlsDisabled(false);
        showThinking(false);
        els.roomStatus.textContent = 'In progress';
        setAnswer(text); // never lose the candidate's words
        showError(
          'Could not submit your answer (' + err.message + '). ' +
          'Your transcript is preserved below — press "Send answer" to retry.'
        );
      });
  }

  els.sendBtn.addEventListener('click', submitAnswer);
  els.clearBtn.addEventListener('click', function () {
    if (state.submitting) {
      return;
    }
    stopListening(false);
    setAnswer('');
    els.interim.textContent = '';
    setSpeechStatus('Cleared — click the mic to record your answer again.', false);
  });

  /* ---------------- speech recognition wiring ---------------- */

  var recognizer = null;

  function appendFinalTranscript(text) {
    var current = getAnswer();
    setAnswer(current ? current + ' ' + text : text);
  }

  function updateMicButton() {
    els.micBtn.classList.toggle('listening', state.listening);
    els.micBtn.textContent = state.listening
      ? '⏹ Stop & submit'
      : '🎤 Start answering';
  }

  function speechBlockReason(code) {
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        return 'Microphone permission was denied.';
      case 'network':
        return 'The speech recognition service is unreachable.';
      case 'audio-capture':
        return 'No microphone was found.';
      default:
        return 'Voice input could not start (' + code + ').';
    }
  }

  function stopListening(submitAfter) {
    if (!recognizer || !state.listening) {
      return;
    }
    state.listening = false;
    state.submitAfterStop = !!submitAfter;
    updateMicButton();
    recognizer.stop(); // final results flush, then onEnd fires

    if (submitAfter) {
      // Safety net: if onEnd never fires, submit anyway after 1.5s.
      state.submitAfterStopTimer = window.setTimeout(function () {
        if (state.submitAfterStop) {
          state.submitAfterStop = false;
          finishStopAndSubmit();
        }
      }, 1500);
    }
  }

  function finishStopAndSubmit() {
    if (state.submitAfterStopTimer) {
      window.clearTimeout(state.submitAfterStopTimer);
      state.submitAfterStopTimer = null;
    }
    els.interim.textContent = '';
    if (getAnswer()) {
      submitAnswer();
    } else {
      setSpeechStatus(
        'Nothing was captured — click the mic and try speaking again.',
        false
      );
    }
  }

  function startListening() {
    if (!recognizer || state.listening || state.submitting || state.voiceBlocked) {
      return;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // don't transcribe our own TTS voice
    }
    clearError();
    state.listening = true;
    state.submitAfterStop = false;
    els.interim.textContent = '';
    updateMicButton();
    setSpeechStatus('Listening… speak your answer, then press stop.', false);
    recognizer.start();
  }

  function initSpeech() {
    if (!window.Speech || !window.Speech.supported) {
      blockVoiceOnly('Your browser does not support speech recognition.');
      return;
    }

    recognizer = window.Speech.createRecognizer({
      onInterim: function (text) {
        els.interim.textContent = text;
      },
      onFinal: function (text) {
        appendFinalTranscript(text);
        els.interim.textContent = '';
      },
      onError: function (code) {
        var fatal =
          ['not-allowed', 'service-not-allowed', 'network', 'audio-capture']
            .indexOf(code) !== -1;
        if (fatal) {
          blockVoiceOnly(speechBlockReason(code));
        } else if (code === 'no-speech') {
          setSpeechStatus("Didn't catch anything yet — try speaking a bit louder.", false);
        } else if (code === 'start-failed') {
          setSpeechStatus('Could not start voice input — click the mic to try again.', true);
        }
      },
      onEnd: function (unexpected) {
        var wasListeningUI = state.listening;
        state.listening = false;
        updateMicButton();
        els.interim.textContent = '';
        if (state.submitAfterStop) {
          state.submitAfterStop = false;
          finishStopAndSubmit();
          return;
        }
        if (unexpected && wasListeningUI && !state.voiceBlocked) {
          setSpeechStatus(
            'Voice input stopped — click the mic to resume; what you said is kept.',
            false
          );
        }
      }
    });

    els.micBtn.addEventListener('click', function () {
      if (state.listening) {
        stopListening(true); // click-to-stop submits the accumulated answer
      } else {
        startListening();
      }
    });
  }

  /* ---------------- initial load ---------------- */

  function renderFromSession(data) {
    var turns = Array.isArray(data.turns) ? data.turns : [];

    var lastInterviewerPos = -1;
    for (var i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === 'interviewer') {
        lastInterviewerPos = i;
        break;
      }
    }

    if (lastInterviewerPos === -1) {
      showError(
        'This session has no interviewer question yet. ' +
        'Try refreshing, or start a new interview from the home page.'
      );
      els.questionText.textContent = 'No question available.';
      els.roomStatus.textContent = 'Unavailable';
      return;
    }

    els.transcript.textContent = '';
    var interviewerTurns = [];
    turns.forEach(function (turn, pos) {
      if (turn.role === 'interviewer') {
        interviewerTurns.push(turn);
      }
      if (pos < lastInterviewerPos) {
        addTurn(turn.role, turn.text, turn.meta || {});
      }
    });

    var current = turns[lastInterviewerPos];
    state.questionNumber = Math.max(interviewerTurns.length - 1, 0);
    setQuestion({
      index: current.index,
      text: current.text,
      meta: current.meta || {}
    });

    derivePanelFromTurns(interviewerTurns);
    var meta = current.meta || {};
    if (meta.rationale) {
      els.dpRationale.textContent = meta.rationale;
    }

    els.roomStatus.textContent = 'In progress';
    setControlsDisabled(false);
    // Attempt to speak the current question on load. Chrome blocks this until
    // the user interacts with the page — the pointerdown fallback covers that.
    speakQuestion(current.text);
  }

  function init() {
    initSpeech();
    updateProgress();
    renderTopics([]);

    fetch(SESSION_URL, { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) {
          return parseErrorResponse(res).then(function (message) {
            throw new Error(message);
          });
        }
        return res.json();
      })
      .then(function (data) {
        if (data.status === 'completed') {
          window.location.href = RESULTS_URL;
          return;
        }
        renderFromSession(data);
      })
      .catch(function (err) {
        els.questionText.textContent = 'Could not load this interview session.';
        els.roomStatus.textContent = 'Error';
        showError(
          'Failed to load the session (' + err.message + '). ' +
          'The API may still be starting up — refresh to retry.'
        );
      });
  }

  init();
})();
