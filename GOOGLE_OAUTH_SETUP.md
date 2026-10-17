# Google OAuth Setup Guide

## Steps to Configure Google OAuth for Customer Login

### 1. Go to Google Cloud Console
Visit: https://console.cloud.google.com/

### 2. Create a New Project (or select existing)
- Click "Select a project" at the top
- Click "New Project"
- Enter project name (e.g., "HotelOne")
- Click "Create"

### 3. Enable Google+ API
- In the left sidebar, go to "APIs & Services" > "Library"
- Search for "Google+ API"
- Click on it and click "Enable"

### 4. Configure OAuth Consent Screen
- Go to "APIs & Services" > "OAuth consent screen"
- Select "External" user type
- Click "Create"
- Fill in the required fields:
  - App name: "Casa Blanca Hotels"
  - User support email: Your email
  - Developer contact: Your email
- Click "Save and Continue"
- On Scopes page, click "Save and Continue"
- On Test users page (optional for development), click "Save and Continue"

### 5. Create OAuth 2.0 Credentials
- Go to "APIs & Services" > "Credentials"
- Click "Create Credentials" > "OAuth client ID"
- Select "Web application"
- Name: "Casa Blanca Web Client"
- Add Authorized JavaScript origins:
  - `http://localhost:3000` (for development)
  - `https://yourdomain.com` (for production)
- Add Authorized redirect URIs:
  - `http://localhost:3000/api/auth/callback/google` (for development)
  - `https://yourdomain.com/api/auth/callback/google` (for production)
- Click "Create"

### 6. Copy Credentials to .env file
After creating the credentials, you'll see:
- **Client ID** - Copy this value
- **Client Secret** - Copy this value

Update your `.env` file:
```env
GOOGLE_CLIENT_ID="your-actual-client-id-here"
GOOGLE_CLIENT_SECRET="your-actual-client-secret-here"
```

### 7. Restart Your Development Server
```bash
npm run dev
```

## Testing

1. Go to http://localhost:3000/login
2. Click "Continue with Google"
3. Sign in with your Google account
4. You should be redirected to the dashboard as a customer

## Security Notes

- **Admin users cannot use Google login** - This is by design for security
- **Only customers can use Google OAuth** - Admins must use email/password at /admin/login
- **Sessions are now more secure** - 7-day session duration with daily refresh
- **Auto-account creation** - New Google users are automatically created as CUSTOMER accounts

## What's Changed

✅ Google OAuth for customer login
✅ Enhanced session security (7 days with 24-hour refresh)
✅ Admin login restricted to credentials only
✅ Separate provider for admin authentication
✅ Auto-create customer accounts from Google sign-in
✅ Prevent admin role from using Google login
