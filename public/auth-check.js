// Проверка авторизации через сервер
async function checkAuth() {
  const publicPages = ['auth.html', 'index.html', 'news.html', 'news-article.html'];
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  
  // Публичные страницы доступны без авторизации
  if (publicPages.includes(currentPage)) {
    return;
  }
  
  try {
    const response = await fetch('/api/user', { credentials: 'include' });
    
    if (!response.ok) {
      // Не авторизован - редирект на auth.html
      window.location.href = 'auth.html';
      return;
    }
    
    const user = await response.json();
    
    // Сохраняем в localStorage для отображения имени
    localStorage.setItem('user', JSON.stringify(user));
    
    // Обновляем навигацию
    updateNavigation(user);
    
  } catch (error) {
    console.error('Ошибка проверки авторизации:', error);
    window.location.href = 'auth.html';
  }
}

// Обновление навигации
function updateNavigation(user) {
  const desktopNav = document.querySelector('.nav');
  const mobileNav = document.querySelector('.mobile-nav');

  // Проверяем не добавили ли уже элементы
  if (desktopNav && desktopNav.querySelector('.user-info')) {
    return; // Уже обновлено
  }

  // Создаём ссылку на имя пользователя
  const userNameLink = document.createElement('a');
  userNameLink.href = 'profile.html';
  userNameLink.style.fontWeight = '600';
  userNameLink.style.color = 'var(--primary)';
  userNameLink.textContent = user.full_name || user.username;
  userNameLink.className = 'user-info';

  // Создаём кнопку выхода
  const logoutLink = document.createElement('a');
  logoutLink.href = '#';
  logoutLink.textContent = 'Выход';
  logoutLink.className = 'user-info';
  logoutLink.onclick = async (e) => {
    e.preventDefault();
    await logout();
  };

  // Добавляем в десктопную навигацию
  if (desktopNav) {
    desktopNav.appendChild(userNameLink.cloneNode(true));
    desktopNav.appendChild(logoutLink.cloneNode(true));
  }

  // Добавляем в мобильную навигацию
  if (mobileNav) {
    mobileNav.appendChild(userNameLink.cloneNode(true));
    mobileNav.appendChild(logoutLink.cloneNode(true));
  }
}

// Функция выхода
async function logout() {
  try {
    await fetch('/api/logout', { 
      method: 'POST',
      credentials: 'include'
    });
    localStorage.removeItem('user');
    window.location.href = 'auth.html';
  } catch (error) {
    console.error('Ошибка выхода:', error);
    localStorage.removeItem('user');
    window.location.href = 'auth.html';
  }
}
