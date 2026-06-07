function togglePassword(id) {
    const input = document.getElementById(id);
    if (!input) return;
    const icon = input.parentElement.querySelector('.toggle-password');
    if (input.type === "password") {
        input.type = "text";
        if (icon) icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = "password";
        if (icon) icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

const loginForm = document.getElementById("loginForm");
if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value;
        const errorDiv = document.getElementById("errorMessage");
        const btn = document.getElementById("loginBtn");

        if (!username || !password) {
            errorDiv.innerText = "Please fill in all fields";
            return;
        }

        btn.classList.add('loading');
        btn.disabled = true;

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                localStorage.setItem("loggedInUser", data.username);
                localStorage.setItem("token", data.token); // Save secure token
                window.location.href = "editor.html";
            } else {
                errorDiv.innerText = data.message || "Invalid credentials";
            }
        } catch (error) {
            errorDiv.innerText = "Cannot connect to server.";
        } finally {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    });
}

const signupForm = document.getElementById("signupForm");
if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("signup-username").value.trim();
        const email = document.getElementById("signup-email").value.trim();
        const password = document.getElementById("signup-password").value;
        const confirmPassword = document.getElementById("confirm-password").value;
        const errorDiv = document.getElementById("signupErrorMessage");
        const btn = document.getElementById("signupBtn");

        if (!username || !email || !password || !confirmPassword) {
            errorDiv.innerText = "Please fill in all fields";
            return;
        }
        if (password !== confirmPassword) {
            errorDiv.innerText = "Passwords do not match!";
            return;
        }

        btn.classList.add('loading');
        btn.disabled = true;

        try {
            const res = await fetch('/api/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });
            const data = await res.json();
            if (data.success) {
                alert("Account Created successfully!");
                window.location.href = "login.html";
            } else {
                errorDiv.innerText = data.message || "Signup failed";
            }
        } catch (error) {
            errorDiv.innerText = "Server connection failed.";
        } finally {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    });
}