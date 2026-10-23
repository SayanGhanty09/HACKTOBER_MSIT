import emailjs from '@emailjs/browser';

// Initialize EmailJS
// Sign up at https://www.emailjs.com/ and get your User ID
const EMAILJS_USER_ID = import.meta.env.VITE_EMAILJS_USER_ID || 'YOUR_USER_ID';
const EMAILJS_SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID || 'YOUR_SERVICE_ID';
const EMAILJS_TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID || 'YOUR_TEMPLATE_ID';

emailjs.init(EMAILJS_USER_ID);

export interface EmailPayload {
  patientName: string;
  patientAge: number;
  recipientEmail: string;
  reportContent: string; // HTML or plain text of the report
}

export const sendReportEmail = async (payload: EmailPayload): Promise<void> => {
  try {
    const templateParams = {
      to_email: 'ghantysayan8@gmail.com',
      patient_name: payload.patientName,
      patient_age: payload.patientAge,
      report_content: payload.reportContent,
      from_name: 'Anebilin Health System',
    };

    const response = await emailjs.send(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      templateParams
    );

    if (response.status === 200) {
      console.log('Email sent successfully');
      return Promise.resolve();
    } else {
      return Promise.reject(new Error('Failed to send email'));
    }
  } catch (error) {
    console.error('Error sending email:', error);
    return Promise.reject(error);
  }
};

export const getEmailJSSetupInstructions = () => {
  return `
To enable email sending:

1. Go to https://www.emailjs.com/ and sign up (free tier available)
2. Create a new email service (Gmail, Outlook, or custom SMTP)
3. Create an email template
4. Copy these values and add them to your .env file:

VITE_EMAILJS_USER_ID=your_user_id
VITE_EMAILJS_SERVICE_ID=your_service_id
VITE_EMAILJS_TEMPLATE_ID=your_template_id

Template variables to use:
- {{to_email}} - recipient email
- {{patient_name}} - patient name
- {{patient_age}} - patient age
- {{report_content}} - the report HTML/text
- {{from_name}} - sender name (Anebilin Health System)
  `;
};
