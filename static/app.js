import { registerPlugin } from '@capacitor/core';

const CurrentWifi = registerPlugin('CurrentWifi');
if (window.Capacitor?.isNativePlatform?.()) document.body?.classList.add('native-app');

document.addEventListener('click', (event) => {
  const button = event.target.closest('.toggle-password');
  if (!button) return;
  const input = document.getElementById(button.getAttribute('aria-controls'));
  if (!input) return;
  event.preventDefault();
  const reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  input.dataset.passwordField = 'true';
  button.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
  button.setAttribute('aria-pressed', String(reveal));
});

document.querySelectorAll('form[data-demo-form]').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = form.querySelector('.status');
    try {
      if (!window.aicousticBackend?.isConfigured) {
        throw new Error('Firebase is not configured. Add your .env.local values and restart the app before creating an account or logging in.');
      }
      await window.aicousticBackend.submitAuth(form);
    } catch (error) {
      if (status) {
        status.textContent = error.message || 'Unable to continue. Check your details and try again.';
        status.hidden = false;
        status.dataset.state = 'error';
      }
    }
  });
});

document.querySelectorAll('[data-google]').forEach((button) => {
  button.addEventListener('click', async () => {
    const status = button.closest('.content')?.querySelector('.status');
    if (status) {
      status.hidden = false;
      status.dataset.state = 'error';
      status.textContent = 'Opening Google sign-in…';
    }
    try {
      if (!window.aicousticBackend?.isConfigured) {
        throw new Error('Firebase is not configured yet. Add the Firebase values to .env.local and restart the app.');
      }
      await window.aicousticBackend.signInWithGoogle();
    } catch (error) {
      if (status) status.textContent = error.message || 'Google sign-in failed. Please try again.';
    }
  });
});

document.querySelectorAll('.profile-menu a[href$="login.html"]').forEach((link) => {
  link.addEventListener('click', async (event) => {
    if (!window.aicousticBackend?.isConfigured) return;
    event.preventDefault();
    try {
      await window.aicousticBackend.logout();
    } finally {
      window.location.assign('login.html');
    }
  });
});

const profileButton = document.querySelector('.profile-button');
const profileMenu = document.querySelector('.profile-menu');
if (profileButton && profileMenu) {
  profileButton.addEventListener('click', () => {
    const open = profileMenu.hidden;
    profileMenu.hidden = !open;
    profileButton.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (event) => {
    if (!profileButton.contains(event.target) && !profileMenu.contains(event.target)) {
      profileMenu.hidden = true;
      profileButton.setAttribute('aria-expanded', 'false');
    }
  });
}

const detectionList = document.querySelector('#detection-list');
if (detectionList) {
  const categoryButtons = [...document.querySelectorAll('.category-filter')];
  const totalElement = document.querySelector('#detection-total');
  const sortToggle = document.querySelector('.sort-toggle');
  const sortMenu = document.querySelector('#sort-menu');
  let selectedCategory = 'All';
  let selectedSort = 'date';

  const renderDetections = () => {
    const rows = [...detectionList.querySelectorAll('.detection-row')];
    const visibleRows = rows.filter((row) => selectedCategory === 'All' || row.dataset.pest === selectedCategory);
    visibleRows.sort((a, b) => {
      if (selectedSort === 'name-asc') return a.dataset.pest.localeCompare(b.dataset.pest) || new Date(b.dataset.date) - new Date(a.dataset.date);
      if (selectedSort === 'name-desc') return b.dataset.pest.localeCompare(a.dataset.pest) || new Date(b.dataset.date) - new Date(a.dataset.date);
      if (selectedSort === 'time') {
        const aTime = new Date(a.dataset.date);
        const bTime = new Date(b.dataset.date);
        return (bTime.getHours() * 60 + bTime.getMinutes()) - (aTime.getHours() * 60 + aTime.getMinutes());
      }
      return new Date(b.dataset.date) - new Date(a.dataset.date);
    });

    rows.forEach((row) => { row.hidden = !visibleRows.includes(row); });
    visibleRows.forEach((row) => detectionList.append(row));
    totalElement.textContent = String(visibleRows.length);
    let emptyMessage = detectionList.querySelector('.empty-history');
    if (!visibleRows.length && !emptyMessage) {
      emptyMessage = document.createElement('p');
      emptyMessage.className = 'empty-history';
      emptyMessage.textContent = 'No detections found.';
      detectionList.append(emptyMessage);
    } else if (visibleRows.length && emptyMessage) emptyMessage.remove();
  };

  categoryButtons.forEach((button) => {
    button.addEventListener('click', () => {
      selectedCategory = button.dataset.category;
      categoryButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      renderDetections();
    });
  });

  sortToggle.addEventListener('click', () => {
    sortMenu.hidden = !sortMenu.hidden;
    sortToggle.setAttribute('aria-expanded', String(!sortMenu.hidden));
  });
  sortMenu.querySelectorAll('[data-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedSort = button.dataset.sort;
      sortMenu.hidden = true;
      sortToggle.setAttribute('aria-expanded', 'false');
      renderDetections();
    });
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.sort-control') && !sortMenu.hidden) {
      sortMenu.hidden = true;
      sortToggle.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('aicoustic:detections-updated', renderDetections);
}

const settingsToast = (message, target = document.querySelector('.settings-toast')) => {
  if (!target) return;
  target.textContent = message;
  target.hidden = false;
  clearTimeout(target._hideTimer);
  target._hideTimer = setTimeout(() => { target.hidden = true; }, 3200);
};

document.querySelectorAll('.accordion-toggle').forEach((button) => {
  button.addEventListener('click', () => {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    if (panel) panel.hidden = expanded;
  });
});

document.querySelectorAll('.edit-profile').forEach((button) => {
  button.addEventListener('click', () => {
    const section = button.closest('.accordion-panel');
    const fields = [...section.querySelectorAll('input')];
    const editing = button.dataset.editing === 'true';
    if (!editing) {
      fields.filter((field) => field.name !== 'email').forEach((field) => field.removeAttribute('readonly'));
      button.dataset.editing = 'true';
      button.textContent = 'Save Profile';
      fields[0]?.focus();
      return;
    }
    fields.forEach((field) => field.setAttribute('readonly', ''));
    const hero = document.querySelector('.account-hero');
    if (hero) {
      hero.querySelector('h1').textContent = fields[0].value || 'Account User';
      hero.querySelector('small').textContent = fields[1].value;
    }
    button.dataset.editing = 'false';
    button.innerHTML = '✎ &nbsp;Edit Profile';
    settingsToast('Profile details saved.');
  });
});

document.querySelectorAll('.show-passwords input').forEach((checkbox) => {
  checkbox.addEventListener('change', () => {
    const form = checkbox.closest('form');
    form.querySelectorAll('input[type="password"], input[type="text"]').forEach((input) => {
      if (input.type === 'password' || input.dataset.passwordField === 'true') {
        input.type = checkbox.checked ? 'text' : 'password';
        input.dataset.passwordField = 'true';
      }
    });
  });
});

document.querySelectorAll('.password-form').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    if (button) button.disabled = true;
    try {
      await window.aicousticBackend.requestCurrentUserPasswordReset();
      settingsToast('Password reset link sent to your email. Verify it there, then choose your new password.');
    } catch (error) {
      settingsToast(error.message || 'Could not send the password verification link.');
    } finally {
      if (button) button.disabled = false;
    }
  });
});

document.querySelectorAll('[data-persist]').forEach((control) => {
  const key = control.dataset.persist;
  const saved = localStorage.getItem(key);
  if (saved !== null) control.checked = saved === 'true';
  control.addEventListener('change', () => localStorage.setItem(key, String(control.checked)));
});

const wifiPage = document.querySelector('#device-wifi-name');
if (wifiPage) {
  const wifiName = document.querySelector('#wifi-name');
  const wifiStatus = document.querySelector('#wifi-status');
  const deviceWifiState = document.querySelector('#device-wifi-state');
  const refreshButton = document.querySelector('.refresh-networks');
  const wifiToast = document.querySelector('.settings-toast');

  const refreshDeviceWifi = async () => {
    refreshButton.disabled = true;
    wifiName.textContent = 'Checking Wi-Fi…';
    wifiPage.textContent = 'Reading this device’s connection…';
    wifiStatus.textContent = 'Checking current connection';
    deviceWifiState.textContent = '';
    try {
      if (!window.Capacitor?.isNativePlatform?.()) {
        wifiName.textContent = 'Android app required';
        wifiPage.textContent = 'Current Wi-Fi name is only available in the installed Android app.';
        wifiStatus.textContent = 'This browser cannot read the connected Wi-Fi name';
        return;
      }
      const result = await CurrentWifi.getCurrentNetwork();
      if (!result.enabled) {
        wifiName.textContent = 'Wi-Fi is off';
        wifiPage.textContent = 'Wi-Fi is turned off on this device.';
        wifiStatus.textContent = 'Enable Wi-Fi in your device settings';
        deviceWifiState.textContent = 'Off';
      } else if (!result.connected) {
        wifiName.textContent = 'No Wi-Fi connection';
        wifiPage.textContent = 'This device is not connected to a Wi-Fi network.';
        wifiStatus.textContent = 'Mobile data or no connection';
        deviceWifiState.textContent = 'Not connected';
      } else if (!result.ssid) {
        wifiName.textContent = 'Wi-Fi name is hidden';
        wifiPage.textContent = result.locationEnabled === false
          ? 'Wi-Fi is connected, but Android hides its name while Location is off. Turn on Location and refresh.'
          : 'Wi-Fi is connected, but Android is hiding its name. Allow Location and Nearby devices permission, then refresh.';
        wifiStatus.textContent = 'Connected; network name unavailable';
        deviceWifiState.textContent = 'Connected';
      } else {
        wifiName.textContent = result.ssid;
        wifiPage.textContent = result.ssid;
        wifiStatus.textContent = 'Connected Wi-Fi on this device';
        deviceWifiState.textContent = 'Connected';
      }
    } catch (error) {
      const message = error?.message || 'Allow Nearby devices permission to read the current Wi-Fi name.';
      wifiName.textContent = 'Wi-Fi permission needed';
      wifiPage.textContent = message;
      wifiStatus.textContent = 'Permission is needed to show the connected network';
      settingsToast(message, wifiToast);
    } finally {
      refreshButton.disabled = false;
    }
  };

  refreshButton.addEventListener('click', refreshDeviceWifi);
  refreshDeviceWifi();
}

const storageActionButtons = document.querySelectorAll('[data-storage-action]');
if (storageActionButtons.length) {
  storageActionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.storageAction;
      const toast = document.querySelector('.settings-toast');
      const usedElement = document.querySelector('#storage-used');
      const recordsElement = document.querySelector('#records-size');
      const systemElement = document.querySelector('#system-size');
      let used = Number(usedElement.textContent);
      let records = Number.parseFloat(recordsElement.textContent);
      let system = Number.parseFloat(systemElement.textContent);
      if (action === 'sync') {
        settingsToast('Cloud sync complete.', toast);
        return;
      }
      if (action === 'clear-storage') {
        if (!window.confirm('Clear the demo detection records from this device?')) return;
        records = 0;
        settingsToast('Detection records cleared in this demo.', toast);
      } else if (action === 'clear-cache') {
        system = Math.max(0, system - 0.3);
        settingsToast('Cache cleared in this demo.', toast);
      }
      used = records + system;
      usedElement.textContent = used.toFixed(1);
      recordsElement.textContent = `${records.toFixed(1)} GB`;
      systemElement.textContent = `${system.toFixed(1)} GB`;
      const percent = Math.round((used / 16) * 100);
      document.querySelector('#storage-percent').textContent = String(percent);
      document.querySelector('#storage-available').textContent = (16 - used).toFixed(1);
      document.querySelector('#storage-bar').style.width = `${percent}%`;
    });
  });
}

const checkUpdatesButton = document.querySelector('#check-updates');
if (checkUpdatesButton) {
  checkUpdatesButton.addEventListener('click', () => {
    const badge = document.querySelector('#firmware-badge');
    const message = document.querySelector('#firmware-message');
    checkUpdatesButton.disabled = true;
    checkUpdatesButton.textContent = 'CHECKING...';
    badge.textContent = 'CHECKING';
    message.hidden = false;
    message.textContent = 'Checking for available firmware updates...';
    setTimeout(() => {
      badge.textContent = 'UP TO DATE';
      message.textContent = 'Your device is running the latest firmware.';
      checkUpdatesButton.textContent = 'CHECK AGAIN';
      checkUpdatesButton.disabled = false;
    }, 900);
  });
}

const forgotPasswordForm = document.querySelector('#forgot-password-form');
if (forgotPasswordForm) {
  forgotPasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.querySelector('#recovery-email').value.trim();
    const status = forgotPasswordForm.querySelector('.recovery-status');
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      status.textContent = 'Enter a valid email address.';
      status.hidden = false;
      return;
    }
    const button = forgotPasswordForm.querySelector('[type="submit"]');
    if (button) button.disabled = true;
    try {
      await window.aicousticBackend.requestPasswordReset(email);
      status.textContent = 'If an account matches this email, Firebase sent a secure password reset link. Check your inbox and spam folder.';
    } catch (error) {
      status.textContent = error.message || 'Could not send the password reset email. Try again later.';
    } finally {
      if (button) button.disabled = false;
      status.hidden = false;
    }
  });
}

const verifyEmailForm = document.querySelector('#verify-email-form');
if (verifyEmailForm) {
  const emailLabel = document.querySelector('#verify-email-address');
  const instructions = document.querySelector('#verify-email-instructions');
  const codeInputs = [...verifyEmailForm.querySelectorAll('.verification-code input')];
  const codeGroup = verifyEmailForm.querySelector('.verification-code');
  const codeSubmit = document.querySelector('#verify-code-submit');
  const checkEmailButton = document.querySelector('#check-email-verification');
  const resendLine = document.querySelector('#resend-line');
  const resendButton = document.querySelector('#resend-code');
  const status = verifyEmailForm.querySelector('.recovery-status');
  const signupVerification = sessionStorage.getItem('aicoustic-signup-verification') === 'true';
  const displayEmail = sessionStorage.getItem('aicoustic-signup-email');
  if (emailLabel) emailLabel.textContent = displayEmail || 'your email';
  if (signupVerification) {
    if (instructions) instructions.innerHTML = 'We sent a verification link to<br><strong id="verify-email-address"></strong>. Open it, then return here.';
    const updatedEmailLabel = document.querySelector('#verify-email-address');
    if (updatedEmailLabel) updatedEmailLabel.textContent = displayEmail || 'your email';
    if (codeGroup) codeGroup.hidden = true;
    if (codeSubmit) codeSubmit.hidden = true;
    if (checkEmailButton) checkEmailButton.hidden = false;
    if (resendLine) resendLine.firstChild.textContent = 'Didn’t receive the link? ';
    status.textContent = sessionStorage.getItem('aicoustic-auth-message') || 'Check your inbox and spam folder for the Firebase verification email.';
    sessionStorage.removeItem('aicoustic-auth-message');
    status.hidden = false;
  } else {
    if (codeGroup) codeGroup.hidden = true;
    if (codeSubmit) codeSubmit.hidden = true;
    status.textContent = 'For password recovery, request a secure reset link from the Forgot Password page.';
    status.hidden = false;
  }

  codeInputs.forEach((input, index) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(-1);
      if (input.value && index < codeInputs.length - 1) codeInputs[index + 1].focus();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !input.value && index > 0) codeInputs[index - 1].focus();
    });
    input.addEventListener('paste', (event) => {
      const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, codeInputs.length);
      if (!pasted) return;
      event.preventDefault();
      pasted.split('').forEach((digit, digitIndex) => { codeInputs[digitIndex].value = digit; });
      codeInputs[Math.min(pasted.length, codeInputs.length - 1)].focus();
    });
  });

  resendButton?.addEventListener('click', async () => {
    if (signupVerification) {
      try {
        await window.aicousticBackend.resendSignupVerificationEmail();
        status.textContent = 'A new verification link was sent. Check your inbox and spam folder.';
      } catch (error) {
        status.textContent = error.message || 'Could not resend the verification email. Try again later.';
      }
      status.hidden = false;
      return;
    }
    status.textContent = 'Request a secure reset link from the Forgot Password page.';
    status.hidden = false;
  });

  checkEmailButton?.addEventListener('click', async () => {
    checkEmailButton.disabled = true;
    try {
      const verified = await window.aicousticBackend.confirmSignupEmailVerified();
      if (verified) {
        window.location.assign('login.html');
        return;
      }
      status.textContent = 'Email is not verified yet. Open the link from Firebase’s email, then try again.';
    } catch (error) {
      status.textContent = error.message || 'Could not check verification yet. Open the email link and try again.';
    } finally {
      checkEmailButton.disabled = false;
      status.hidden = false;
    }
  });

  verifyEmailForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = 'Open the verification link from your email to continue.';
    status.hidden = false;
  });
}

const resetPasswordForm = document.querySelector('#reset-password-form');
if (resetPasswordForm) {
  const actionParams = new URLSearchParams(window.location.search);
  const resetCode = actionParams.get('oobCode');
  const isPasswordResetLink = actionParams.get('mode') === 'resetPassword' && Boolean(resetCode);
  const status = resetPasswordForm.querySelector('.recovery-status');
  if (!isPasswordResetLink) {
    status.textContent = 'To change your password, open the secure reset link sent to your email.';
    status.hidden = false;
  }
  resetPasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = document.querySelector('#new-password').value;
    const confirmation = document.querySelector('#confirm-new-password').value;
    const termsAccepted = document.querySelector('#reset-terms').checked;
    if (!isPasswordResetLink) {
      status.textContent = 'Open the password reset link from your email before setting a new password.';
      status.hidden = false;
      return;
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      status.textContent = 'Use at least 8 characters, including a letter, a number, and a special character.';
      status.hidden = false;
      return;
    }
    if (password !== confirmation) {
      status.textContent = 'The passwords do not match.';
      status.hidden = false;
      return;
    }
    if (!termsAccepted) {
      status.textContent = 'Please accept the Terms and Conditions.';
      status.hidden = false;
      return;
    }
    const submitButton = resetPasswordForm.querySelector('[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    try {
      await window.aicousticBackend.completePasswordReset(resetCode, password);
      status.textContent = 'Your password was changed. Returning to log in…';
      status.hidden = false;
      sessionStorage.setItem('password-reset-complete', 'true');
      setTimeout(() => window.location.assign('login.html'), 900);
    } catch (error) {
      status.textContent = error.message || 'This reset link is invalid or expired. Request a new one.';
      status.hidden = false;
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

if (window.location.pathname.endsWith('/login.html') && sessionStorage.getItem('password-reset-complete') === 'true') {
  const loginStatus = document.querySelector('#login-form .status');
  if (loginStatus) loginStatus.textContent = 'Password reset complete. You can now log in.';
  sessionStorage.removeItem('password-reset-complete');
}

const notificationButton = document.querySelector('.notification-button');
const notificationMenu = document.querySelector('#notification-menu');
if (notificationButton && notificationMenu) {
  notificationButton.addEventListener('click', () => {
    const open = notificationMenu.hidden;
    notificationMenu.hidden = !open;
    notificationButton.setAttribute('aria-expanded', String(open));
    if (profileMenu) {
      profileMenu.hidden = true;
      profileButton?.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('click', (event) => {
    if (!notificationButton.contains(event.target) && !notificationMenu.contains(event.target)) {
      notificationMenu.hidden = true;
      notificationButton.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !notificationMenu.hidden) {
      notificationMenu.hidden = true;
      notificationButton.setAttribute('aria-expanded', 'false');
      notificationButton.focus();
    }
  });
}
