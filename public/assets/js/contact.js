/* Contact form: POST /api/contact. The mailto link stays as the fallback. */
(function () {
  "use strict";
  var form = document.getElementById("contact-form");
  if (!form) return;
  var status = document.getElementById("contact-status");
  var submit = form.querySelector("[type=submit]");
  var sending = false;

  function setStatus(kind, text) {
    if (!status) return;
    status.classList.remove("is-error", "is-success");
    status.textContent = "";
    window.setTimeout(function () {
      if (!text) {
        status.setAttribute("aria-live", "polite");
        return;
      }
      status.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
      if (kind === "error") status.classList.add("is-error");
      if (kind === "success") status.classList.add("is-success");
      status.textContent = text;
    }, 30);
  }

  function setSending(on) {
    sending = on;
    if (!submit) return;
    if (on) {
      submit.setAttribute("aria-disabled", "true");
      submit.setAttribute("aria-busy", "true");
    } else {
      submit.removeAttribute("aria-disabled");
      submit.removeAttribute("aria-busy");
    }
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (sending) return;
    if (typeof form.reportValidity === "function" && !form.reportValidity()) return;

    var payload = {
      name: form.elements.name.value,
      email: form.elements.email.value,
      message: form.elements.message.value,
      gotcha: form.elements.gotcha.value
    };

    setStatus("", "");
    setSending(true);

    fetch("/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (body) {
        return { ok: res.ok, body: body };
      }).catch(function () {
        return { ok: false, body: null };
      });
    }).then(function (result) {
      if (result.ok && result.body && result.body.ok === true) {
        form.reset();
        setStatus("success", "Message sent.");
        return;
      }
      var message = result.body && typeof result.body.error === "string"
        ? result.body.error
        : "Could not send. Try the email link below.";
      setStatus("error", message);
    }).catch(function () {
      setStatus("error", "Could not send. Try the email link below.");
    }).then(function () {
      setSending(false);
    });
  });
})();
