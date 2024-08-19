# Notifications
Notifications Service is responsible for delivering messages to users. Notification messages are created
as a result of specific application events. These events need to be formatted into user-friendly messages
and delivered to the user on the nominated communication channels. In a nutshell, Notifications Service is 
responsible for handling:

* Conversion of event data to messages via message templates
* Resolve the recipient list based on user communication preferences
* Ensure delivery of messages to users on the prescribed channels.

### Communication Preferences
Out of the box, the platform provides the necessary API and data structures to capture user's communication preferences 
via contacts and subscriptions. A user can add multiple contacts to his/her profile. Each contact involves a delivery 
address,the communication channel that it's applicable to, and where necessary the passphrase for sending messages to the 
the address. 

Users can then specify their communication preference via defining a set of subscriptions. Each subscription record maps an application event to a contact. Users can add multiple subscriptions for the same event across different communication channels or address if they so choose. 

By default, the platform adds a subscription to the `auth.forgetPassword` event to the user's email contact to ensure that the user
will receive email notifications relating to password recovery.

### Notification Providers
Notification Provider is responsible for formatting application event data into user-friendly messages and its delivery
on a particular communication channel. Note that the same application event may result in different notification messages
based on limitations of the channel (such as SMS where we want to keep the message short) and the content type (html vs plain text).

You may want to register multiple notification providers in order to support different multiple channels
(email, SMS, Telegram etc). A default provider is included in the Platform for handling emails. It makes use of PugJS for message templating and Sendgrid for delivery.

### Message Delivery
Message delivery involves the following steps:
1. Calculate a list of delivery addresses based on all users' communication preferences.
2. Save the individual message to the `MessageOutbox` table with status `PENDING`
3. Invoke the relevant notification provider to perform the sending of message.
4. Upon successful delivery, the corresponding record in `MessageOutbox` has its status updated to `DELIVERED`

Individual implementation of `NotificationProvider` may choose to perform retries by querying for pending records stored within `MessageOutbox`. 

