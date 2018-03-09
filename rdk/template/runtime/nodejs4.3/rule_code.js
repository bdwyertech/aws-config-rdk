/*
#    Copyright 2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
#    Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance with the License. A copy of the License is located at
#
#        http://aws.amazon.com/apache2.0/
#
#    or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
*/

// RULE DESCRIPTION
/// This example rule checks that EC2 instances are of the desired instance type
// The desired instance type is specified in the rule parameters.
//
// RULE DETAILS
// Trigger Type (Change Triggered or Periodic: Change Triggered

// Required Parameters: desiredInstanceType - t2.micro
// Rule parameters defined in rules/ruleCode/ruleParameters.txt

'use strict';

const aws = require('aws-sdk');

const config = new aws.ConfigService();
// This rule needs to be uploaded with rule_util.py. It is automatically done when using the RDK.
const rule_util = require('./rule_util');

// This is where it's determined whether the resource is compliant or not.
// In this example, we simply decide that the resource is compliant if it is an instance and its type matches the type specified as the desired type.
// If the resource is not an EC2 instance, then we deem this resource to be not applicable. (If the scope of the rule is specified to include only
// instances, this rule would never have been invoked.)
function evaluateCompliance(configurationItem, ruleParameters) {
    if (configurationItem.resourceType !== 'AWS::EC2::Instance') {
        return 'NOT_APPLICABLE';
    } else if (ruleParameters.desiredInstanceType === configurationItem.configuration.instanceType) {
        return 'COMPLIANT';
    }
    return 'NON_COMPLIANT';
}

function rule_handler(event, context, callback) {
    console.info(event);
    const invokingEvent = JSON.parse(event.invokingEvent);
    const configItem = invokingEvent.configurationItem;
    const ruleParameters = JSON.parse(event.ruleParameters);
    callback(null, evaluateCompliance(configItem, ruleParameters));
}

exports.lambda_handler = (event, context, callback) => {
    rule_util.decorate_handler(rule_handler)(event, context, callback);
}

// Helper function used to validate input
function checkDefined(reference, referenceName) {
    if (!reference) {
        throw new Error(`Error: ${referenceName} is not defined`);
    }
    return reference;
}

// Check whether the message is OversizedConfigurationItemChangeNotification or not
function isOverSizedChangeNotification(messageType) {
    checkDefined(messageType, 'messageType');
    return messageType === 'OversizedConfigurationItemChangeNotification';
}

// Check whether the message is a ScheduledNotification or not
function isScheduledNotification(messageType) {
  checkDefined(messageType, 'messageType');
  return messageType === 'ScheduledNotification'
}

// Get configurationItem using getResourceConfigHistory API.
function getConfiguration(resourceType, resourceId, configurationCaptureTime, callback) {
    config.getResourceConfigHistory({ resourceType, resourceId, laterTime: new Date(configurationCaptureTime), limit: 1 }, (err, data) => {
        if (err) {
            callback(err, null);
        }
        const configurationItem = data.configurationItems[0];
        callback(null, configurationItem);
    });
}

// Convert from the API model to the original invocation model
/*eslint no-param-reassign: ["error", { "props": false }]*/
function convertApiConfiguration(apiConfiguration) {
    apiConfiguration.awsAccountId = apiConfiguration.accountId;
    apiConfiguration.ARN = apiConfiguration.arn;
    apiConfiguration.configurationStateMd5Hash = apiConfiguration.configurationItemMD5Hash;
    apiConfiguration.configurationItemVersion = apiConfiguration.version;
    apiConfiguration.configuration = JSON.parse(apiConfiguration.configuration);
    if ({}.hasOwnProperty.call(apiConfiguration, 'relationships')) {
        for (let i = 0; i < apiConfiguration.relationships.length; i++) {
            apiConfiguration.relationships[i].name = apiConfiguration.relationships[i].relationshipName;
        }
    }
    return apiConfiguration;
}

// Based on the type of message get the configuration item either from configurationItem in the invoking event or using the getResourceConfigHistiry API in getConfiguration function.
function getConfigurationItem(invokingEvent, callback) {
    checkDefined(invokingEvent, 'invokingEvent');
    if (isOverSizedChangeNotification(invokingEvent.messageType)) {
        const configurationItemSummary = checkDefined(invokingEvent.configurationItemSummary, 'configurationItemSummary');
        getConfiguration(configurationItemSummary.resourceType, configurationItemSummary.resourceId, configurationItemSummary.configurationItemCaptureTime, (err, apiConfigurationItem) => {
            if (err) {
                callback(err);
            }
            const configurationItem = convertApiConfiguration(apiConfigurationItem);
            callback(null, configurationItem);
        });
    } else if (isScheduledNotification(invokingEvent.messageType)) {
      callback(null, null)
    } else {
        checkDefined(invokingEvent.configurationItem, 'configurationItem');
        callback(null, invokingEvent.configurationItem);
    }
}

// Check whether the resource has been deleted. If it has, then the evaluation is unnecessary.
function isApplicable(configurationItem, event) {
    checkDefined(configurationItem, 'configurationItem');
    checkDefined(event, 'event');
    const status = configurationItem.configurationItemStatus;
    const eventLeftScope = event.eventLeftScope;
    return (status === 'OK' || status === 'ResourceDiscovered') && eventLeftScope === false;
}

// This is the handler that's invoked by Lambda
// Most of this code is boilerplate; use as is
exports.lambda_handler = (event, context, callback) => {
    checkDefined(event, 'event');
    const invokingEvent = JSON.parse(event.invokingEvent);
    const ruleParameters = JSON.parse(event.ruleParameters);
    getConfigurationItem(invokingEvent, (err, configurationItem) => {
        if (err) {
            callback(err);
        }
        if (!configurationItem){
          callback("RDK utility class does not yet support Scheduled Notifications.")
        }
        let compliance = 'NOT_APPLICABLE';
        const putEvaluationsRequest = {};
        if (isApplicable(configurationItem, event)) {
            invokingEvent.configurationItem = configurationItem;
            event.invokingEvent = JSON.stringify(invokingEvent);
            rule_handler(event, context, (err, computedCompliance) => {
                if (err) {
                    callback(err);
                }
                compliance = computedCompliance;
            });
        }
        // Put together the request that reports the evaluation status
        if (typeof compliance === 'string' || compliance instanceof String){
          putEvaluationsRequest.Evaluations = [
              {
                  ComplianceResourceType: configurationItem.resourceType,
                  ComplianceResourceId: configurationItem.resourceId,
                  ComplianceType: compliance,
                  OrderingTimestamp: configurationItem.configurationItemCaptureTime,
              },
          ];
        } else if (compliance instanceof Array){
          fields = ['ComplianceResourceType', 'ComplianceResourceId', 'ComplianceType', 'OrderingTimestamp']
          for (var i = 0; i < compliace.length; i++) {
            compliance_result = compliance[i];

            var missing_fields = false;
            for (var j = 0; j < fields.length){
              if (!compliance_result[fields[j]){
                console.info("Missing " + fields[j] + " from custom evaluation.")
                missing_fields = true;
              }
            }

            if (!missing_fields){
              putEvaluationsRequest.Evaluations.append(compliance_result);
            }
          }
        } else {
          putEvaluationsRequest.Evaluations = [
              {
                  ComplianceResourceType: configurationItem.resourceType,
                  ComplianceResourceId: configurationItem.resourceId,
                  ComplianceType: 'NOT_APPLICABLE',
                  OrderingTimestamp: configurationItem.configurationItemCaptureTime,
              },
          ];
        }

        putEvaluationsRequest.ResultToken = event.resultToken;

        // Invoke the Config API to report the result of the evaluation
        config.putEvaluations(putEvaluationsRequest, (error, data) => {
            if (error) {
                callback(error, null);
            } else if (data.FailedEvaluations.length > 0) {
                // Ends the function execution if any evaluation results are not successfully reported.
                callback(JSON.stringify(data), null);
            } else {
                callback(null, data);
            }
        });
    });
};
