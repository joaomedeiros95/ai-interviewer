/**
 * interview.js — interview room controller.
 *
 * Loads session state (GET /api/sessions/<id>/), renders the transcript and
 * the current question, handles voice + typed answers through one submit path
 * (POST /api/sessions/<id>/answers/), and keeps the decision panel live.
 * Speech is optional sugar: every failure path leaves the textarea working.
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
    micBtn: document.getElementById('mic-btn'),
    speechStatus: document.getElementById('speech-status'),
    interim: document.getElementById('interim-text'),
    answerText: document.getElementById('answer-text'),
    sendBtn: document.getElementById('send-btn'),
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
    micSupported: false,
    submitAfterStop: false,
    submitAfterStopTimer: null
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

  function setControlsDisabled(disabled) {
    if (state.micSupported) {
      els.micBtn.disabled = disabled;
    }
    els.answerText.disabled = disabled;
    els.sendBtn.disabled = disabled;
  }

  function showThinking(on) {
    els.thinking.hidden = !on;
  }

  function setSpeechStatus(message, isError) {
    els.speechStatus.textContent = message || '';
    els.speechStatus.classList.toggle('is-error', !!isError);
  }

  /* ---------------- text-to-speech ---------------- */

  function speakQuestion(text) {
    if (!('speechSynthesis' in window)) {
      return;
    }
    try {
      window.speechSynthesis.cancel(); // never overlap questions
      if (!els.ttsToggle.checked || !text) {
        return;
      }
      var utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
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
    var text = els.answerText.value.trim();
    if (!text) {
      setSpeechStatus('Say or type something first — the answer box is empty.', false);
      els.answerText.focus();
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
        els.answerText.value = '';
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
        els.answerText.value = text; // never lose the candidate's words
        showError(
          'Could not submit your answer (' + err.message + '). ' +
          'Your text is preserved below — please try sending again.'
        );
      });
  }

  els.sendBtn.addEventListener('click', submitAnswer);
  els.answerText.addEventListener('keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      submitAnswer();
    }
  });

  /* ---------------- speech recognition wiring ---------------- */

  var recognizer = null;

  function appendFinalTranscript(text) {
    var current = els.answerText.value;
    els.answerText.value = current ? current.replace(/\s+$/, '') + ' ' + text : text;
    els.answerText.scrollTop = els.answerText.scrollHeight;
  }

  function updateMicButton() {
    els.micBtn.classList.toggle('listening', state.listening);
    els.micBtn.textContent = state.listening
      ? '⏹ Stop & submit'
      : '🎤 Start answering';
  }

  function speechErrorMessage(code) {
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        return 'Microphone permission denied — you can type your answer instead.';
      case 'network':
        return 'Speech service unavailable — type instead.';
      case 'audio-capture':
        return 'No microphone found — you can type your answer instead.';
      case 'no-speech':
        return "Didn't catch anything yet — try speaking a bit louder.";
      case 'start-failed':
        return 'Could not start voice input — you can type your answer instead.';
      default:
        return 'Voice input hiccup (' + code + ') — you can always type below.';
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
    if (els.answerText.value.trim()) {
      submitAnswer();
    } else {
      setSpeechStatus(
        'Nothing was captured — try again, or type your answer below.',
        false
      );
    }
  }

  function startListening() {
    if (!recognizer || state.listening || state.submitting) {
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
      state.micSupported = false;
      els.micBtn.hidden = true;
      setSpeechStatus(
        'Voice input needs Chrome or Edge — type your answer below.',
        false
      );
      return;
    }

    state.micSupported = true;
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
        setSpeechStatus(speechErrorMessage(code), fatal);
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
        if (unexpected && wasListeningUI) {
          setSpeechStatus(
            'Voice input stopped — click the mic to resume, or type below.',
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
    // Note: we deliberately don't auto-speak on load — browsers block
    // speechSynthesis before a user gesture anyway.
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
