# Firebase Setup for Chyrris KAI

This project connects to **Owl Fenc's Firebase** to display real-time data from the production app.

## Required Firebase Credentials

The project needs the **Firebase Admin SDK service account JSON file** to access Firestore and Authentication.

### Setup Instructions for Replit

1. **Upload the service account JSON file** to the project root:
   - File name: `owl-fenc-firebase-adminsdk-fbsvc-dd2b8690d3.json`
   - Location: `/home/ubuntu/chyrris-kai/` (project root)
   - **IMPORTANT**: This file is already in `.gitignore` and will NOT be pushed to GitHub

2. **Verify the file exists**:
   ```bash
   ls -la owl-fenc-firebase-adminsdk-*.json
   ```

3. **Restart the server** (Replit will do this automatically)

### Security Notes

- ⚠️ **NEVER commit the Firebase service account JSON to Git**
- ✅ The file is already added to `.gitignore`
- ✅ GitHub will block pushes if credentials are detected
- ✅ Keep the file only in your local Replit environment

### What Data is Accessed

The dashboard displays **real-time data** from Owl Fenc Firebase:

- **7 users** from Firebase Authentication
- **996 clients** from Firestore `clients` collection
- **4 contracts** from Firestore `contracts` collection
- **25 invoices** from Firestore `invoices` collection

### Troubleshooting

If you see "0 users" or empty data:

1. Check if the service account JSON file exists in the project root
2. Verify the file name matches exactly: `owl-fenc-firebase-adminsdk-fbsvc-dd2b8690d3.json`
3. Restart the Replit server
4. Check the console for Firebase initialization errors

### File Structure

```
/home/ubuntu/chyrris-kai/
├── server/
│   └── services/
│       ├── firebase.ts              # Firebase Admin SDK initialization
│       └── owlfenc-firebase.ts      # Owl Fenc data queries
├── owl-fenc-firebase-adminsdk-*.json  # Service account (NOT in git)
└── FIREBASE_SETUP.md                  # This file
```

### API Endpoints

The following tRPC endpoints fetch real data from Firebase:

- `owlfenc.getStats` - Dashboard statistics
- `owlfenc.getUsers` - All users from Firebase Auth
- `owlfenc.getClients` - All clients from Firestore

All endpoints are **public** (no authentication required) for now.
