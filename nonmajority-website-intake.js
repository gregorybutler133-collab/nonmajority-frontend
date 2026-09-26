/*
 * Nonmajority Digital -> Nonmajority CRM lead intake
 * --------------------------------------------------
 * Drop this in as a single <script src="/nonmajority-website-intake.js"></script>
 * tag before </body> on every page of nonmajoritydigital.com that has a
 * contact / intake / CTA form. It auto-attaches to every <form> on the page
 * (no HTML edits required), posts to the existing nonmajority-api Worker,
 * and creates a real lead in the existing CRM's Leads section.
 *
 * No required edits. INTAKE_KEY below is left blank on purpose: anything
 * placed here is visible to anyone who views this file, so it is not a
 * real secret and the Worker does not require it. The actual protection
 * against spam/abuse is the Worker's origin allowlist plus a honeypot
 * field this script adds automatically. If you ever want one extra,
 * low-value filter against blind bots, you can set a value here and add
 * the matching PUBLIC_INTAKE_KEY secret on the Worker later -- neither
 * side requires the other.
 *
 * To exclude a specific form, add data-nm-skip to its <form> tag.
 * To force which "service" value a page's forms report, add
 * data-nm-service="AI & Automation" (etc.) to the <form> tag; otherwise it
 * is guessed from the page's URL path.
 */
(function () {
  "use strict";

  var API_BASE = "https://nonmajority-api.gregorybutler133.workers.dev";
  var INTAKE_KEY = ""; // optional, see note above -- leave blank unless you've set PUBLIC_INTAKE_KEY on the Worker too

  var SERVICE_OPTIONS = ["Website", "AI & Automation", "Content Marketing", "CRM", "Marketing", "Other"];

  function serviceFromPath() {
    var p = location.pathname.toLowerCase();
    if (p.indexOf("ai-automation") > -1) return "AI & Automation";
    if (p.indexOf("content-marketing") > -1) return "Content Marketing";
    if (p.indexOf("crm") > -1) return "CRM";
    if (p.indexOf("website") > -1) return "Website";
    if (p.indexOf("marketing") > -1) return "Marketing";
    return "Other";
  }

  function fieldKey(el) {
    return ((el.name || el.id || "") + "").toLowerCase();
  }

  function extractFields(form) {
    var out = { name: "", business: "", email: "", phone: "", website: "", message: "" };
    var els = form.querySelectorAll("input, textarea, select");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.type === "hidden" || el.type === "submit" || el.type === "button") continue;
      var key = fieldKey(el);
      var val = (el.value || "").trim();
      if (!val || !key) continue;
      if (el.type === "email" || /email/.test(key)) out.email = out.email || val;
      else if (el.type === "tel" || /phone|tel|mobile/.test(key)) out.phone = out.phone || val;
      else if (/business|company|brand/.test(key)) out.business = out.business || val;
      else if (/website|site|url|domain/.test(key)) out.website = out.website || val;
      else if (/message|comment|detail|note|project/.test(key)) out.message = out.message || val;
      else if (/service|interest|topic/.test(key) && SERVICE_OPTIONS.indexOf(val) > -1) out.service = val;
      else if (/name/.test(key) && !/business|company/.test(key)) out.name = out.name || val;
    }
    return out;
  }

  function addHoneypot(form) {
    var hp = document.createElement("input");
    hp.type = "text";
    hp.name = "hp";
    hp.autocomplete = "off";
    hp.tabIndex = -1;
    hp.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0;";
    hp.setAttribute("aria-hidden", "true");
    form.appendChild(hp);
    return hp;
  }

  function showMessage(form, text, isError) {
    var box = form.querySelector(".nm-intake-msg");
    if (!box) {
      box = document.createElement("div");
      box.className = "nm-intake-msg";
      box.style.cssText = "margin-top:12px;font-size:14px;";
      form.appendChild(box);
    }
    box.textContent = text;
    box.style.color = isError ? "#b91c1c" : "#15803d";
  }

  function handleSubmit(form, hp) {
    return function (e) {
      e.preventDefault();
      var fields = extractFields(form);
      var payload = {
        name: fields.name,
        business: fields.business,
        email: fields.email,
        phone: fields.phone,
        website: fields.website,
        message: fields.message,
        service: fields.service || form.getAttribute("data-nm-service") || serviceFromPath(),
        hp: hp.value
      };

      var submitBtn = form.querySelector('[type="submit"]');
      var originalLabel = submitBtn ? submitBtn.textContent : null;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Sending...";
      }

      fetch(API_BASE + "/v1/public/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (r) {
          return r.json().then(function (data) {
            return { ok: r.ok, data: data };
          });
        })
        .then(function (result) {
          if (result.ok) {
            form.reset();
            showMessage(form, "Thanks - we got your message and will be in touch soon.", false);
          } else {
            showMessage(form, (result.data && result.data.error) || "Something went wrong. Please try again, or email us directly.", true);
          }
        })
        .catch(function () {
          showMessage(form, "Something went wrong. Please try again, or email us directly.", true);
        })
        .finally(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalLabel;
          }
        });
    };
  }

  function init() {
    var forms = document.querySelectorAll("form:not([data-nm-skip])");
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i];
      var hp = addHoneypot(form);
      form.addEventListener("submit", handleSubmit(form, hp));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
