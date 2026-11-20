(function () {
    var stored = localStorage.getItem("nufit-lang");
    var initial = stored || (navigator.language && navigator.language.toLowerCase().startsWith("id") ? "id" : "en");
    document.documentElement.setAttribute("data-lang", initial);

    document.addEventListener("DOMContentLoaded", function () {
        document.querySelectorAll("[data-lang-set]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                var lang = btn.getAttribute("data-lang-set");
                document.documentElement.setAttribute("data-lang", lang);
                localStorage.setItem("nufit-lang", lang);
            });
        });
    });
})();
