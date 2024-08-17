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

Furthermore, the platform maintains a subscription list between different application events and individual contacts. 
This enables the user to define exactly which application event will trigger notifications on which contact.

### Notification Providers
Notification Provider is responsible for formatting application event data into user-friendly messages and its delivery
on a particular communication channel. Note that the same application event may result in different notification messages
based on limitations of the channel (such as SMS where we want to keep the message short) and the content type (html vs plain text).

You may want to register multiple notification providers in order to enable notification delivery via multiple channels
(email, SMS, Telegram etc).

### Message Delivery
